/**
 * Leave management tools.
 *
 * The flow the brief asks for: an employee requests leave in Arabic or English,
 * the agent checks the balance against BambooHR, applies the correct country
 * entitlement rule, routes approval to the line manager, and confirms or
 * rejects with a notification back to the employee.
 *
 * Validation deliberately happens before the HRIS write, so an employee gets
 * "you have 4 days left and asked for 6" rather than an API validation error.
 */
import { z } from 'zod';
import type { LuaTool } from 'lua-cli';
import { Channels, Lua, User } from 'lua-cli';

import { calculateEntitlement } from '../../domain/entitlement.js';
import { leaveRuleFor } from '../../domain/rules/leave.js';
import { formatDate, inclusiveDays, parseDate, today, compareDates } from '../../domain/date.js';
import { parseCountry, type LeaveType } from '../../domain/types.js';
import { getHris } from '../../services/bamboohr/index.js';
import { getOpsSheet } from '../../services/sheets/index.js';
import { HrisError, HrisPermissionError } from '../../services/bamboohr/types.js';
import { formatDays, pick, t } from '../../services/i18n.js';
import { currentEmployee, currentLanguage } from './calculationTools.js';

const leaveTypeSchema = z
  .enum(['annual', 'sick', 'emergency', 'unpaid', 'maternity', 'paternity', 'hajj', 'bereavement'])
  .describe('Type of leave. Default to "annual" when the employee just says "leave" or "holiday".');

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Dates must be ISO format, YYYY-MM-DD.')
  .describe('ISO date, YYYY-MM-DD.');

export class GetLeaveBalanceTool implements LuaTool {
  name = 'get_leave_balance';
  description =
    'Show an employee their leave balances: statutory entitlement for their country and tenure, ' +
    'days already used, days pending approval, and days still available. Use for any "how many ' +
    'days do I have left" question. Resolves the employee from the conversation.';

  inputSchema = z.object({
    employeeId: z
      .string()
      .optional()
      .describe('Employee id. Omit to use the person in this conversation. HR only for others.'),
  });

  async execute(input: z.infer<typeof this.inputSchema>): Promise<unknown> {
    const language = await currentLanguage();
    const me = await currentEmployee();

    // Looking at somebody else's balance is an HR or line-manager action.
    let employee = me;
    if (input.employeeId && input.employeeId !== me?.id) {
      const target = await getHris().getEmployee(input.employeeId);
      const allowed = me?.isHrStaff || target?.supervisorId === me?.id;
      if (!allowed) return { ok: false, message: t('hrOnly', language) };
      employee = target;
    }

    if (!employee) return { ok: false, message: t('notIdentified', language) };

    const balances = await getHris().getLeaveBalances(employee.id);
    const annualRule = leaveRuleFor(employee.country, 'annual');
    const entitlement = annualRule
      ? calculateEntitlement({ hireDate: employee.hireDate }, annualRule)
      : null;

    return {
      ok: true,
      employee: { id: employee.id, name: employee.displayName, country: employee.country },
      serviceLength: entitlement ? pick(entitlement.serviceLabel, language) : undefined,
      balances: balances.map((b) => ({
        leaveType: b.leaveType,
        entitlementDays: b.entitlementDays,
        usedDays: b.usedDays,
        pendingDays: b.pendingDays,
        availableDays: b.availableDays,
        carriedOverDays: b.carriedOverDays,
        summary:
          language === 'ar'
            ? `${formatDays(b.availableDays, 'ar')} متاحة من أصل ${formatDays(b.entitlementDays, 'ar')}`
            : `${b.availableDays} of ${b.entitlementDays} days available`,
      })),
      // "You move to 30 days on 1 March 2028" is far more useful than a bare number.
      nextEntitlementChange: entitlement?.nextStepUp
        ? {
            date: entitlement.nextStepUp.date,
            newEntitlementDays: entitlement.nextStepUp.days,
            inDays: entitlement.nextStepUp.inDays,
          }
        : null,
      citation: entitlement?.citation,
      warning: entitlement?.warning ? pick(entitlement.warning, language) : undefined,
    };
  }
}

export class CheckLeaveEntitlementTool implements LuaTool {
  name = 'check_leave_entitlement';
  description =
    'Explain the statutory leave entitlement rule for a country and length of service, with the ' +
    'legal citation. Use for policy questions such as "how many days do staff in the UAE get?" or ' +
    '"when do I move to 30 days?" — this answers the RULE, not a specific balance. For an actual ' +
    'balance use get_leave_balance instead.';

  inputSchema = z.object({
    country: z
      .string()
      .optional()
      .describe('SA, AE, EG, JO, or a country name. Defaults to the employee record.'),
    leaveType: leaveTypeSchema.default('annual'),
    hireDate: isoDate.optional().describe('Defaults to the employee record.'),
  });

  async execute(input: z.infer<typeof this.inputSchema>): Promise<unknown> {
    const language = await currentLanguage();
    const employee = await currentEmployee();

    const country = input.country ? parseCountry(input.country) : (employee?.country ?? null);
    if (!country) {
      return {
        ok: false,
        message: 'Tell me which country: Saudi Arabia, the UAE, Egypt or Jordan.',
      };
    }

    const rule = leaveRuleFor(country, input.leaveType);
    if (!rule) {
      return {
        ok: false,
        message: `I do not have a ${input.leaveType} leave rule on file for ${country}. I have logged this as a gap for HR.`,
        country,
        leaveType: input.leaveType,
      };
    }

    const hireDate = input.hireDate ?? employee?.hireDate;
    const result = hireDate ? calculateEntitlement({ hireDate }, rule) : null;

    return {
      ok: true,
      country,
      leaveType: input.leaveType,
      dayBasis: rule.dayBasis,
      // The whole band table, so the agent can explain the shape of the rule.
      bands: rule.bands.map((b) => ({
        fromYear: b.fromYear,
        toYear: b.toYear,
        days: b.days,
        description:
          b.toYear === null
            ? `${b.days} days from year ${b.fromYear} onwards`
            : `${b.days} days for years ${b.fromYear} to ${b.toYear}`,
      })),
      yourEntitlementDays: result?.days,
      nextStepUp: result?.nextStepUp ?? null,
      citation: rule.citation,
      source: rule.sourceUrl,
      notes: rule.notes,
      warning: result?.warning ? pick(result.warning, language) : undefined,
    };
  }
}

export class SubmitLeaveRequestTool implements LuaTool {
  name = 'submit_leave_request';
  description =
    'Submit a leave request to BambooHR for the employee in this conversation and notify their line ' +
    'manager. Validates the dates and the available balance first. Use once you have the leave type, ' +
    'a start date and an end date. Always confirm the dates back to the employee before calling this.';

  inputSchema = z.object({
    leaveType: leaveTypeSchema.default('annual'),
    startDate: isoDate.describe('First day of leave, inclusive.'),
    endDate: isoDate.describe('Last day of leave, inclusive. Same as startDate for a single day.'),
    notes: z.string().optional().describe('Short reason, if the employee gave one.'),
  });

  async execute(input: z.infer<typeof this.inputSchema>): Promise<unknown> {
    const language = await currentLanguage();
    const employee = await currentEmployee();
    if (!employee) return { ok: false, message: t('notIdentified', language) };

    const start = parseDate(input.startDate);
    const end = parseDate(input.endDate);

    if (compareDates(end, start) < 0) {
      return {
        ok: false,
        message:
          language === 'ar'
            ? 'تاريخ النهاية يجب أن يكون في نفس يوم البداية أو بعده.'
            : 'The end date must be on or after the start date.',
      };
    }

    // Backdating is a policy exception, not something an agent should do silently.
    if (compareDates(start, today()) < 0 && input.leaveType !== 'sick') {
      return {
        ok: false,
        message:
          language === 'ar'
            ? 'لا يمكنني تقديم طلب إجازة بأثر رجعي. يُرجى التواصل مع الموارد البشرية للإجازات السابقة.'
            : 'I cannot submit a backdated leave request. Please contact HR for leave already taken.',
        needsHuman: true,
      };
    }

    const days = inclusiveDays(start, end);

    // Check the balance before writing, so the employee gets a useful message.
    const balances = await getHris().getLeaveBalances(employee.id);
    const balance = balances.find((b) => b.leaveType === input.leaveType);
    if (balance && days > balance.availableDays) {
      return {
        ok: false,
        insufficientBalance: true,
        requestedDays: days,
        availableDays: balance.availableDays,
        message:
          language === 'ar'
            ? `طلبت ${formatDays(days, 'ar')} ولكن لديك ${formatDays(balance.availableDays, 'ar')} متاحة فقط.`
            : `You asked for ${days} days but only ${balance.availableDays} are available.`,
      };
    }

    let request;
    try {
      request = await getHris().createLeaveRequest({
        employeeId: employee.id,
        leaveType: input.leaveType as LeaveType,
        startDate: input.startDate,
        endDate: input.endDate,
        ...(input.notes ? { notes: input.notes } : {}),
      });
    } catch (error) {
      if (error instanceof HrisError) {
        return { ok: false, message: error.message };
      }
      throw error;
    }

    const channel = Lua.request.channel;

    // Route the approval. A failure to notify must not lose the request, which
    // is already safely in the HRIS, so this is reported rather than thrown.
    const notification = await notifyManager(employee.supervisorId, {
      employeeName: employee.displayName,
      requestId: request.id,
      leaveType: input.leaveType,
      startDate: input.startDate,
      endDate: input.endDate,
      days,
    });

    // Audit trail to the HR Ops sheet.
    await safeAudit({
      recordedAt: new Date().toISOString(),
      requestId: request.id,
      employeeId: employee.id,
      employeeName: employee.displayName,
      country: employee.country,
      leaveType: input.leaveType,
      startDate: input.startDate,
      endDate: input.endDate,
      days,
      decision: 'submitted',
      decidedBy: '',
      channel,
    });

    return {
      ok: true,
      requestId: request.id,
      status: 'pending',
      days,
      startDate: input.startDate,
      endDate: input.endDate,
      approver: employee.supervisorName || 'HR',
      managerNotified: notification.delivered,
      managerNotificationNote: notification.note,
      message:
        language === 'ar'
          ? `تم تقديم طلبك (${request.id}) لمدة ${formatDays(days, 'ar')} وأُرسل إلى ${employee.supervisorName || 'الموارد البشرية'} للموافقة.`
          : `Request ${request.id} for ${days} days has been submitted and sent to ${employee.supervisorName || 'HR'} for approval.`,
    };
  }
}

export class GetLeaveRequestStatusTool implements LuaTool {
  name = 'get_leave_request_status';
  description =
    'List the leave requests for the employee in this conversation, with their status. Use for ' +
    '"what happened to my leave request" or "do I have anything pending".';

  inputSchema = z.object({
    status: z
      .enum(['pending', 'approved', 'rejected', 'cancelled'])
      .optional()
      .describe('Filter to one status. Omit for all.'),
  });

  async execute(input: z.infer<typeof this.inputSchema>): Promise<unknown> {
    const language = await currentLanguage();
    const employee = await currentEmployee();
    if (!employee) return { ok: false, message: t('notIdentified', language) };

    const requests = await getHris().listLeaveRequests({
      employeeId: employee.id,
      ...(input.status ? { status: input.status } : {}),
    });

    return {
      ok: true,
      count: requests.length,
      requests: requests.map((r) => ({
        id: r.id,
        leaveType: r.leaveType,
        startDate: r.startDate,
        endDate: r.endDate,
        days: r.days,
        status: r.status,
        notes: r.notes,
        decisionNote: r.decisionNote,
      })),
      message:
        requests.length === 0
          ? language === 'ar'
            ? 'لا توجد طلبات إجازة مسجلة لك.'
            : 'You have no leave requests on file.'
          : undefined,
    };
  }
}

export class DecideLeaveRequestTool implements LuaTool {
  name = 'decide_leave_request';
  description =
    'Approve or reject a pending leave request, and notify the employee on their own channel in ' +
    'their own language. Only the requester\'s line manager or HR staff can do this. Use when a ' +
    'manager says "approve LR-1234" or "reject Ahmad\'s leave".';

  inputSchema = z.object({
    requestId: z.string().describe('The leave request id, e.g. LR-5003.'),
    decision: z.enum(['approve', 'reject']).describe('What the manager decided.'),
    note: z.string().optional().describe('Optional note shown to the employee.'),
  });

  /** Only offered to people who actually manage someone, or to HR. */
  async condition(): Promise<boolean> {
    const me = await currentEmployee();
    if (!me) return false;
    if (me.isHrStaff) return true;
    const reports = await getHris().listEmployees({ supervisorId: me.id });
    return reports.length > 0;
  }

  async execute(input: z.infer<typeof this.inputSchema>): Promise<unknown> {
    const language = await currentLanguage();
    const actor = await currentEmployee();
    if (!actor) return { ok: false, message: t('notIdentified', language) };

    const hris = getHris();
    const existing = await hris.getLeaveRequest(input.requestId);
    if (!existing) {
      return { ok: false, message: `I could not find leave request ${input.requestId}.` };
    }

    const status = input.decision === 'approve' ? 'approved' : 'rejected';

    let updated;
    try {
      // Authorisation is enforced inside the HRIS adapter, not here, so it
      // cannot be bypassed by another caller.
      updated = await hris.setLeaveRequestStatus(input.requestId, status, actor.id, input.note);
    } catch (error) {
      if (error instanceof HrisPermissionError) {
        return { ok: false, notAuthorised: true, message: error.message };
      }
      if (error instanceof HrisError) {
        return { ok: false, message: error.message };
      }
      throw error;
    }

    const subject = await hris.getEmployee(updated.employeeId);
    const notification = await notifyEmployeeOfDecision(subject, updated, status, input.note);

    await safeAudit({
      recordedAt: new Date().toISOString(),
      requestId: updated.id,
      employeeId: updated.employeeId,
      employeeName: updated.employeeName,
      country: subject?.country ?? 'SA',
      leaveType: updated.leaveType,
      startDate: updated.startDate,
      endDate: updated.endDate,
      days: updated.days,
      decision: status,
      decidedBy: actor.id,
      channel: Lua.request.channel,
    });

    return {
      ok: true,
      requestId: updated.id,
      status,
      employeeName: updated.employeeName,
      employeeNotified: notification.delivered,
      employeeNotificationNote: notification.note,
      message: `${updated.employeeName}'s request ${updated.id} has been ${status}.`,
    };
  }
}

/* -------------------------------------------------------------------------- */
/* Notification helpers                                                        */
/* -------------------------------------------------------------------------- */

interface NotifyResult {
  delivered: boolean;
  note?: string;
}

/**
 * Notifies a line manager that a request needs their decision.
 *
 * Outbound messaging is best-effort by design. The request is already recorded
 * in the HRIS, so a delivery failure must degrade to "tell the employee their
 * manager was not reachable", never to losing the request.
 */
async function notifyManager(
  supervisorId: string,
  details: {
    employeeName: string;
    requestId: string;
    leaveType: string;
    startDate: string;
    endDate: string;
    days: number;
  },
): Promise<NotifyResult> {
  if (!supervisorId) {
    return { delivered: false, note: 'No line manager on record; HR will pick this up.' };
  }

  try {
    const manager = await getHris().getEmployee(supervisorId);
    if (!manager) return { delivered: false, note: 'Line manager not found in the HRIS.' };

    const managerLanguage = manager.preferredLanguage ?? 'en';
    const text =
      managerLanguage === 'ar'
        ? `طلب إجازة جديد بانتظار موافقتك.\n${details.employeeName} — ${formatDays(details.days, 'ar')}\nمن ${details.startDate} إلى ${details.endDate}\nرقم الطلب: ${details.requestId}\nللموافقة، اكتب: approve ${details.requestId}`
        : `New leave request awaiting your approval.\n${details.employeeName} — ${details.days} days\n${details.startDate} to ${details.endDate}\nRequest: ${details.requestId}\nTo approve, reply: approve ${details.requestId}`;

    const user = await User.get({ email: manager.workEmail });
    if (user) {
      await user.send([{ type: 'text', text }]);
      return { delivered: true };
    }

    // No Lua user record: fall back to an addressed channel send.
    const sent = await Channels.send({
      channel: manager.isFieldWorker ? 'whatsapp' : 'email',
      to: manager.isFieldWorker
        ? { phoneNumber: manager.mobilePhone }
        : { email: manager.workEmail },
      text,
    });
    // WhatsApp defers rather than delivers when Meta's 24-hour window is shut.
    return sent.queued
      ? { delivered: false, note: 'Queued: the manager has not messaged recently, so WhatsApp deferred it until they reply.' }
      : { delivered: sent.delivered };
  } catch (error) {
    return {
      delivered: false,
      note: `Could not reach the line manager: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/** Confirms or declines back to the employee, on their channel, in their language. */
async function notifyEmployeeOfDecision(
  subject: { workEmail: string; mobilePhone: string; isFieldWorker: boolean; preferredLanguage?: 'en' | 'ar' } | null,
  request: { id: string; startDate: string; endDate: string; days: number },
  status: 'approved' | 'rejected',
  note?: string,
): Promise<NotifyResult> {
  if (!subject) return { delivered: false, note: 'Employee record not found.' };

  const language = subject.preferredLanguage ?? 'en';
  const approved = status === 'approved';

  const text =
    language === 'ar'
      ? `${approved ? 'تمت الموافقة على' : 'تم رفض'} طلب إجازتك ${request.id}.\nمن ${request.startDate} إلى ${request.endDate} (${formatDays(request.days, 'ar')})${note ? `\nملاحظة: ${note}` : ''}`
      : `Your leave request ${request.id} has been ${status}.\n${request.startDate} to ${request.endDate} (${request.days} days)${note ? `\nNote: ${note}` : ''}`;

  try {
    const user = await User.get({ email: subject.workEmail });
    if (user) {
      await user.send([{ type: 'text', text }]);
      return { delivered: true };
    }
    const sent = await Channels.send({
      channel: subject.isFieldWorker ? 'whatsapp' : 'email',
      to: subject.isFieldWorker
        ? { phoneNumber: subject.mobilePhone }
        : { email: subject.workEmail },
      text,
    });
    return sent.queued
      ? { delivered: false, note: 'Queued: WhatsApp 24-hour window closed, it will flush when they next message us.' }
      : { delivered: sent.delivered };
  } catch (error) {
    // WhatsApp's 24-hour window is the usual culprit here.
    return {
      delivered: false,
      note: `Decision recorded, but the employee could not be messaged: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/** Audit writes must never fail a leave decision. */
async function safeAudit(row: Parameters<ReturnType<typeof getOpsSheet>['appendLeaveAudit']>[0]): Promise<void> {
  try {
    await getOpsSheet().appendLeaveAudit(row);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn(`[leave] audit row could not be written: ${String(error)}`);
  }
}

export const leaveTools = [
  new GetLeaveBalanceTool(),
  new CheckLeaveEntitlementTool(),
  new SubmitLeaveRequestTool(),
  new GetLeaveRequestStatusTool(),
  new DecideLeaveRequestTool(),
];
