/**
 * Statutory leave entitlement.
 *
 * As with gratuity, no country-specific branching lives here — the `LeaveRule`
 * carries every jurisdictional difference. The result deliberately includes the
 * date the employee's entitlement next steps up, because "you get 21 days now
 * and 30 from 1 March 2027" is a far more useful answer than a bare number.
 */
import type { LeaveRule } from './rules/schema.js';
import type { CountryCode, LeaveType } from './types.js';
import {
  addMonthsClamped,
  compareDates,
  formatDate,
  parseDate,
  serviceDuration,
  today,
  type PlainDate,
} from './date.js';
import type { Bilingual } from './gratuity.js';

export interface EntitlementInput {
  hireDate: string;
  /** Defaults to today in Riyadh. */
  asOf?: string;
}

export interface EntitlementResult {
  country: CountryCode;
  leaveType: LeaveType;
  /** Full annual entitlement at `asOf`, in days. */
  days: number;
  dayBasis: 'calendar' | 'working';
  serviceYears: number;
  /** Human-readable service length. */
  serviceLabel: Bilingual;
  /** Null when the employee is already in the top band. */
  nextStepUp: {
    /** ISO date the higher entitlement begins. */
    date: string;
    days: number;
    /** Whole days from `asOf` until the step-up. */
    inDays: number;
  } | null;
  /** True when the employee has not yet reached the first qualifying band. */
  notYetQualified: boolean;
  citation: string;
  sourceUrl: string;
  verified: boolean;
  warning?: Bilingual;
}

function bandFor(years: number, bands: LeaveRule['bands']): LeaveRule['bands'][number] | null {
  for (const band of bands) {
    const upper = band.toYear ?? Number.POSITIVE_INFINITY;
    if (years >= band.fromYear && years < upper) return band;
  }
  return null;
}

/**
 * The date the employee reaches a given whole-year service anniversary.
 * Uses clamped month arithmetic so a 29 February hire date behaves sensibly.
 */
function anniversary(hireDate: PlainDate, years: number): PlainDate {
  return addMonthsClamped(hireDate, Math.round(years * 12));
}

export function calculateEntitlement(
  input: EntitlementInput,
  rule: LeaveRule,
): EntitlementResult {
  const hire = parseDate(input.hireDate);
  const asOf = input.asOf ? parseDate(input.asOf) : today();

  if (compareDates(asOf, hire) < 0) {
    throw new Error(
      `As-of date ${formatDate(asOf)} precedes hire date ${formatDate(hire)}.`,
    );
  }

  const service = serviceDuration(hire, asOf);
  const years = service.decimalYears;
  const current = bandFor(years, rule.bands);

  // Below the first band's floor the employee has not yet qualified at all.
  const firstBand = rule.bands[0]!;
  const notYetQualified = current === null && years < firstBand.fromYear;

  // Find the next band above the current position, if any.
  const upcoming = rule.bands.find((b) => b.fromYear > years) ?? null;
  const nextStepUp = upcoming
    ? (() => {
        const date = anniversary(hire, upcoming.fromYear);
        return {
          date: formatDate(date),
          days: upcoming.days,
          inDays: Math.max(0, Math.round((Date.parse(formatDate(date)) - Date.parse(formatDate(asOf))) / 86_400_000)),
        };
      })()
    : null;

  const serviceLabel: Bilingual = {
    en: `${service.years} years, ${service.months} months`,
    ar: `${service.years} سنة و${service.months} شهر`,
  };

  return {
    country: rule.country,
    leaveType: rule.leaveType,
    days: current?.days ?? 0,
    dayBasis: rule.dayBasis,
    serviceYears: years,
    serviceLabel,
    nextStepUp,
    notYetQualified,
    citation: rule.citation,
    sourceUrl: rule.sourceUrl,
    verified: rule.verified,
    ...(rule.verified
      ? {}
      : {
          warning: {
            en: `The ${rule.leaveType} leave rule for ${rule.country} has not been confirmed against a primary legal source. Treat this as indicative and confirm with HR.`,
            ar: `قاعدة إجازة ${rule.leaveType} الخاصة بـ ${rule.country} لم يتم التحقق منها من مصدر قانوني أساسي. يُرجى اعتبارها استرشادية والتأكد من الموارد البشرية.`,
          },
        }),
  };
}

/**
 * Pro-rated entitlement for a partial leave year, used when someone joins or
 * leaves mid-year. Rounded to one decimal place, which is how HR systems
 * conventionally present accrued balances.
 */
export function proRateEntitlement(fullYearDays: number, daysWorkedInYear: number): number {
  if (daysWorkedInYear < 0) {
    throw new Error('Days worked in year cannot be negative.');
  }
  const capped = Math.min(daysWorkedInYear, 365);
  return Math.round((fullYearDays * capped) / 365 * 10) / 10;
}
