/**
 * The bespoke HR calculation tools: end-of-service gratuity and residency
 * permit expiry.
 *
 * Both resolve the employee from the conversation where they can, so an
 * employee can just ask "what would my gratuity be if I resign?" without
 * knowing their own hire date or wage. Both also accept explicit parameters, so
 * HR can model a scenario for someone else.
 */
import { z } from 'zod';
import type { LuaTool } from 'lua-cli';
import { Lua, User } from 'lua-cli';

import { calculateGratuity } from '../../domain/gratuity.js';
import { CURRENCIES, gratuityRuleFor } from '../../domain/rules/gratuity.js';
import { checkIqamaExpiry } from '../../domain/iqama.js';
import { formatDate, today } from '../../domain/date.js';
import { COUNTRIES, parseCountry, type CountryCode, type Language } from '../../domain/types.js';
import { getHris } from '../../services/bamboohr/index.js';
import { pick, t } from '../../services/i18n.js';
import type { Employee } from '../../services/bamboohr/types.js';
import { linkHasExpired } from '../../domain/accountLink.js';

/**
 * Resolves the employee behind the current conversation.
 *
 * Web users arrive with an email, WhatsApp users with a phone number, so both
 * are tried. Returns null rather than throwing: an unmatched user should get a
 * helpful message, not a stack trace.
 */
export async function currentEmployee(): Promise<Employee | null> {
  const user = await User.get();
  if (!user) return null;

  const profile = user._luaProfile;
  const email = profile?.emailAddresses?.[0] ?? (user.email as string | undefined);
  const phone = profile?.mobileNumbers?.[0] ?? (user.phone as string | undefined);
  const name = profile?.fullName ?? (user.name as string | undefined);

  // An employee id pinned onto the user record wins over any lookup — but only
  // while it is still fresh. The pin is set by account linking, which exists
  // for the web widget, and LuaPop resumes a conversation from a session id it
  // keeps in localStorage forever. Without a lifetime the pin outlives the
  // person: the next visitor on that browser profile inherits the last one's
  // identity. An expired pin is ignored rather than rejected, so a channel that
  // identifies its own sender falls through to the lookup below untouched.
  const pinned = user.employeeId as string | undefined;
  const hris = getHris();
  if (pinned && !linkHasExpired(user.linkedAt as string | undefined, new Date().toISOString())) {
    const byId = await hris.getEmployee(pinned);
    if (byId) return byId;
  }

  return hris.findEmployee({
    ...(email ? { email } : {}),
    ...(phone ? { phone } : {}),
    ...(name ? { name } : {}),
  });
}

/** Language preference stored on the user record by the preprocessor. */
export async function currentLanguage(): Promise<Language> {
  const user = await User.get();
  const stored = user?.preferredLanguage as Language | undefined;
  return stored === 'ar' ? 'ar' : 'en';
}

const separationSchema = z
  .enum(['resignation', 'termination', 'end_of_contract', 'force_majeure'])
  .describe(
    'Why employment ends. "resignation" means the employee quit, which reduces the award in some ' +
      'countries. "termination" means the employer ended it. Use "force_majeure" for death or total disability.',
  );

export class CalculateGratuityTool implements LuaTool {
  name = 'calculate_gratuity';
  description =
    'Calculate an end-of-service gratuity (EOSB) with a full step-by-step breakdown and the legal ' +
    'citation. Resolves the employee from the conversation when no employee id is given. Use this ' +
    'whenever someone asks what they would receive on leaving, resigning, or being terminated.';

  inputSchema = z.object({
    employeeId: z
      .string()
      .optional()
      .describe('Employee id. Omit to use the person in this conversation.'),
    country: z
      .string()
      .optional()
      .describe('Country of employment (SA, AE, EG, JO, or a name like "Saudi Arabia"). Defaults to the employee record.'),
    monthlyWage: z
      .number()
      .positive()
      .optional()
      .describe('Monthly wage. Defaults to the wage on the employee record.'),
    hireDate: z.string().optional().describe('ISO start date, YYYY-MM-DD. Defaults to the record.'),
    endDate: z
      .string()
      .optional()
      .describe('ISO last working day, YYYY-MM-DD. Defaults to today.'),
    separationReason: separationSchema.default('resignation'),
  });

  async execute(input: z.infer<typeof this.inputSchema>): Promise<unknown> {
    const language = await currentLanguage();
    const hris = getHris();

    const employee = input.employeeId
      ? await hris.getEmployee(input.employeeId)
      : await currentEmployee();

    // Every field can be overridden, but each falls back to the record so the
    // employee does not have to know their own hire date.
    const country: CountryCode | null = input.country
      ? parseCountry(input.country)
      : (employee?.country ?? null);

    if (!country) {
      return {
        ok: false,
        message:
          'I need to know which country you are employed in. Tell me Saudi Arabia, the UAE, Egypt or Jordan.',
        supportedCountries: COUNTRIES,
      };
    }

    const monthlyWage = input.monthlyWage ?? employee?.monthlyWage;
    const hireDate = input.hireDate ?? employee?.hireDate;

    if (!monthlyWage || !hireDate) {
      return {
        ok: false,
        message: employee
          ? 'Your record is missing a wage or hire date, so I cannot calculate this. Please contact HR.'
          : t('notIdentified', language),
      };
    }

    const rule = gratuityRuleFor(country);
    const result = calculateGratuity(
      {
        monthlyWage,
        hireDate,
        endDate: input.endDate ?? formatDate(today()),
        separationReason: input.separationReason,
      },
      rule,
      CURRENCIES[country],
    );

    return {
      ok: true,
      employee: employee ? { id: employee.id, name: employee.displayName } : undefined,
      country,
      amount: result.amount,
      currency: result.currency,
      serviceLength: `${result.service.years}y ${result.service.months}m ${result.service.days}d`,
      separationReason: input.separationReason,
      // The breakdown is the point. Present it as steps, not a bare number.
      breakdown: result.breakdown.map((step) => ({
        label: pick(step.label, language),
        detail: pick(step.detail, language),
      })),
      citation: result.rule.citation,
      source: result.rule.sourceUrl,
      wageBasis:
        result.rule.wageBase === 'basic_plus_allowances'
          ? 'Calculated on the last wage including regular allowances.'
          : 'Calculated on basic wage only.',
      capApplied: result.capApplied,
      // Never let an unverified legal figure reach an employee unqualified.
      warning: result.warning ? pick(result.warning, language) : undefined,
      disclaimer: t('indicativeOnly', language),
    };
  }
}

export class CheckPermitExpiryTool implements LuaTool {
  name = 'check_residency_permit_expiry';
  description =
    'Check how long an employee has left on their Iqama (Saudi Arabia) or Emirates ID (UAE), with ' +
    'the urgency band and what to do next. Resolves the employee from the conversation when no id ' +
    'is given. Use for any question about Iqama or Emirates ID validity, renewal timing, or expiry.';

  inputSchema = z.object({
    employeeId: z
      .string()
      .optional()
      .describe('Employee id. Omit to use the person in this conversation.'),
  });

  async execute(input: z.infer<typeof this.inputSchema>): Promise<unknown> {
    const language = await currentLanguage();
    const employee = input.employeeId
      ? await getHris().getEmployee(input.employeeId)
      : await currentEmployee();

    if (!employee) {
      return { ok: false, message: t('notIdentified', language) };
    }
    if (!employee.residencyPermitExpiry) {
      return {
        ok: true,
        employeeId: employee.id,
        hasPermit: false,
        message: t('noPermitOnFile', language),
      };
    }

    const status = checkIqamaExpiry({
      employeeId: employee.id,
      expiryDate: employee.residencyPermitExpiry,
      documentType: employee.residencyPermitType ?? 'iqama',
    });

    return {
      ok: true,
      employeeId: employee.id,
      employeeName: employee.displayName,
      hasPermit: true,
      document: pick(status.documentLabel, language),
      expiryDate: status.expiryDate,
      daysRemaining: status.daysRemaining,
      severity: status.severity,
      actionRequired: status.actionRequired,
      message: pick(status.message, language),
      // Point at the procedure rather than restating it, so the SOP stays the
      // single source of truth.
      relatedProcedure: 'Search the knowledge base for the Iqama Renewal procedure.',
    };
  }
}

/**
 * HR-only: everyone whose permit is inside the monitoring horizon.
 * Gated by `condition`, which the platform evaluates fail-closed.
 */
export class ListExpiringPermitsTool implements LuaTool {
  name = 'list_expiring_permits';
  description =
    'HR only. List every employee whose Iqama or Emirates ID expires within a horizon, most urgent ' +
    'first. Use when HR asks who needs renewal attention.';

  inputSchema = z.object({
    horizonDays: z
      .number()
      .int()
      .min(1)
      .max(365)
      .default(90)
      .describe('How many days ahead to look. Defaults to 90.'),
  });

  async condition(): Promise<boolean> {
    const employee = await currentEmployee();
    return Boolean(employee?.isHrStaff);
  }

  async execute(input: z.infer<typeof this.inputSchema>): Promise<unknown> {
    const language = await currentLanguage();
    const employees = await getHris().listEmployeesWithPermits();

    const rows = employees
      .map((e) =>
        checkIqamaExpiry({
          employeeId: e.id,
          expiryDate: e.residencyPermitExpiry!,
          documentType: e.residencyPermitType ?? 'iqama',
        }),
      )
      .filter((s) => s.daysRemaining <= input.horizonDays)
      .sort((a, b) => a.daysRemaining - b.daysRemaining);

    const byId = new Map(employees.map((e) => [e.id, e]));

    return {
      ok: true,
      horizonDays: input.horizonDays,
      count: rows.length,
      employees: rows.map((s) => {
        const e = byId.get(s.employeeId)!;
        return {
          employeeId: s.employeeId,
          name: e.displayName,
          country: e.country,
          location: e.location,
          document: pick(s.documentLabel, language),
          expiryDate: s.expiryDate,
          daysRemaining: s.daysRemaining,
          severity: s.severity,
          lineManager: e.supervisorName,
        };
      }),
    };
  }
}

/** Convenience for tests and the skill definition. */
export const calculationTools = [
  new CalculateGratuityTool(),
  new CheckPermitExpiryTool(),
  new ListExpiringPermitsTool(),
];

export { Lua };
