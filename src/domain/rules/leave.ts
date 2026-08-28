/**
 * Leave entitlement, sick-leave and probation rules, one row per country.
 *
 * Same provenance policy as the gratuity table: `verified: true` only where the
 * figure was actually confirmed during this build. Everything else is flagged,
 * and the agent tells the employee the answer is indicative.
 */
import type { CountryCode, LeaveType } from '../types.js';
import type { LeaveRule, ProbationRule, SickLeaveRule } from './schema.js';

type LeaveTable = Record<CountryCode, Partial<Record<LeaveType, LeaveRule>>>;

export const LEAVE_RULES: LeaveTable = {
  SA: {
    /**
     * Saudi Labour Law Article 109. Verified: the 21/30 split at five years of
     * service is stated in the employer brief and matches the statute.
     */
    annual: {
      country: 'SA',
      leaveType: 'annual',
      bands: [
        { fromYear: 0, toYear: 5, days: 21 },
        { fromYear: 5, toYear: null, days: 30 },
      ],
      dayBasis: 'calendar',
      citation: 'Saudi Labour Law, Article 109',
      sourceUrl: 'https://www.hrsd.gov.sa/',
      verified: true,
      lastReviewed: '2026-08-28',
      notes:
        'Entitlement rises from 21 to 30 days once the employee completes five continuous years with the employer.',
    },
    emergency: {
      country: 'SA',
      leaveType: 'emergency',
      bands: [{ fromYear: 0, toYear: null, days: 5 }],
      dayBasis: 'calendar',
      citation: 'Company policy (not statutory) — HR Policy HRP-014',
      sourceUrl: 'https://internal.example.com/policies/HRP-014',
      verified: false,
      lastReviewed: '2026-08-28',
      notes:
        'Emergency leave is a company benefit rather than a statutory entitlement. Days beyond the allowance are deducted from annual leave.',
    },
    hajj: {
      country: 'SA',
      leaveType: 'hajj',
      bands: [{ fromYear: 2, toYear: null, days: 10 }],
      dayBasis: 'calendar',
      citation: 'Saudi Labour Law, Article 114 (UNVERIFIED)',
      sourceUrl: 'https://www.hrsd.gov.sa/',
      verified: false,
      lastReviewed: '2026-08-28',
      notes:
        'Granted once during the period of service to an employee who has not previously performed Hajj. Confirm the qualifying service period and the day count.',
    },
  },

  AE: {
    /**
     * UAE Federal Decree-Law 33/2021, Article 29. VERIFIED.
     *
     * A flat 30 days with no seniority escalator, unlike every other country
     * here. Calendar days, not working days: Article 29(7) folds weekends and
     * public holidays falling inside the leave into the leave itself. The
     * statute says "working days" elsewhere when it means them, so the bare
     * "days" in Article 29 is deliberate.
     */
    annual: {
      country: 'AE',
      leaveType: 'annual',
      bands: [{ fromYear: 1, toYear: null, days: 30 }],
      dayBasis: 'calendar',
      citation: 'UAE Federal Decree-Law 33/2021, Article 29',
      sourceUrl: 'https://uaelegislation.gov.ae/en/legislations/1541',
      verified: true,
      lastReviewed: '2026-08-28',
      notes:
        'Between six and twelve months of service the accrual is two days per month, which these tenure bands do not model. Whether anything accrues below six months is not resolved on the face of Article 29. Untaken leave is payable on exit regardless of duration.',
    },
  },

  EG: {
    /**
     * Egypt Labour Law No. 14 of 2025, Article 124. VERIFIED.
     *
     * Note the first-year figure: 15 days, not 21. Law 14/2025 replaced Law
     * 12/2003 on 1 September 2025 and introduced a lower first-year tier, so
     * any guidance still saying "21 days after one year" is out of date.
     */
    annual: {
      country: 'EG',
      leaveType: 'annual',
      bands: [
        { fromYear: 0, toYear: 1, days: 15 },
        { fromYear: 1, toYear: 10, days: 21 },
        { fromYear: 10, toYear: null, days: 30 },
      ],
      // Article 124 expressly excludes official holidays and weekly rest days
      // from the count, so these behave as working days.
      dayBasis: 'working',
      citation: 'Egypt Labour Law No. 14 of 2025, Article 124',
      sourceUrl: 'https://ar.wikisource.org/wiki/قانون_العمل_14_لسنة_2025_-_مصر',
      verified: true,
      lastReviewed: '2026-08-28',
      notes:
        'Two entitlements are not modelled by these tenure bands: the 30-day tier also applies on reaching age 50 regardless of service, and persons with disabilities and persons of short stature receive 45 days. Hazardous work or remote areas add 7 days by ministerial decision. Accrual in year one is pro-rata subject to a six-month qualifying period.',
    },
  },

  JO: {
    annual: {
      country: 'JO',
      leaveType: 'annual',
      bands: [
        { fromYear: 0, toYear: 5, days: 14 },
        { fromYear: 5, toYear: null, days: 21 },
      ],
      // Article 61 excludes official holidays, religious holidays and weekends
      // from the count, so these behave as working days.
      dayBasis: 'working',
      citation: 'Jordan Labour Law No. 8 of 1996, Article 61 (as amended 2019)',
      sourceUrl:
        'https://www.mol.gov.jo/ebv4.0/root_storage/en/eb_list_page/final_labor_law_(with_2023_amendments)_qa_(2).pdf',
      verified: true,
      lastReviewed: '2026-08-28',
      notes:
        'Rises to 21 days after five consecutive years with the same employer. Carry-over is permitted to the following year only, and lapses after that. Leave may be split in blocks of not less than two days.',
    },
  },
};

export const SICK_LEAVE_RULES: Record<CountryCode, SickLeaveRule> = {
  SA: {
    country: 'SA',
    tiers: [
      { fromDay: 1, toDay: 30, payRate: 1 },
      { fromDay: 31, toDay: 90, payRate: 0.75 },
      { fromDay: 91, toDay: 120, payRate: 0 },
    ],
    citation: 'Saudi Labour Law, Article 117 (UNVERIFIED)',
    sourceUrl: 'https://www.hrsd.gov.sa/',
    verified: false,
    lastReviewed: '2026-08-28',
    notes:
      'Working assumption: first 30 days at full wage, next 60 days at three quarters, final 30 days unpaid, within a single year.',
  },
  AE: {
    country: 'AE',
    tiers: [
      { fromDay: 1, toDay: 15, payRate: 1 },
      { fromDay: 16, toDay: 45, payRate: 0.5 },
      { fromDay: 46, toDay: 90, payRate: 0 },
    ],
    citation: 'UAE Federal Decree-Law 33/2021, Article 31',
    sourceUrl: 'https://uaelegislation.gov.ae/en/legislations/1541',
    verified: true,
    lastReviewed: '2026-08-28',
    notes:
      'Ninety days per year in total, consecutive or intermittent. There is NO paid sick leave during probation. Illness must be notified within three business days with a Medical Authority report. The unpaid tier is still job-protected: the employer may only terminate once the 90 days are exhausted.',
  },
  /**
   * Egypt Labour Law No. 14 of 2025, Article 131. VERIFIED, with an important
   * qualification.
   *
   * The general private-sector rule sets NO day counts and NO percentages in the
   * Labour Law itself: duration is set by the competent medical authority and
   * the pay rate is governed by the Social Insurance and Pensions Law 148/2019
   * (broadly 75% of the insured wage for the first 90 days, then 85%, to 180
   * days a year).
   *
   * The tiered structure encoded below is the SECOND paragraph of Article 131,
   * which applies only to industrial establishments subject to the Industrial
   * Facility Licensing Law No. 15 of 2017. This employer is an industrial
   * conglomerate, so it is the applicable rule for its Egyptian plant staff —
   * but it would be the wrong rule for a purely commercial employer, and many
   * English summaries quote it without the qualification.
   *
   * The tiers run per three years of service, not per calendar year, and apply
   * where the medical authority considers recovery likely. Whatever social
   * insurance pays is deducted from the employer's liability, so the employer
   * tops up rather than paying twice.
   */
  EG: {
    country: 'EG',
    tiers: [
      { fromDay: 1, toDay: 90, payRate: 1 },
      { fromDay: 91, toDay: 270, payRate: 0.85 },
      { fromDay: 271, toDay: 360, payRate: 0.75 },
    ],
    citation: 'Egypt Labour Law No. 14 of 2025, Article 131 (second paragraph — industrial establishments)',
    sourceUrl: 'https://ar.wikisource.org/wiki/قانون_العمل_14_لسنة_2025_-_مصر',
    verified: true,
    lastReviewed: '2026-08-28',
    notes:
      'Applies to industrial establishments under Law 15/2017 and runs per three years of service. For non-industrial staff the general rule applies instead: duration set by the medical authority, pay per Social Insurance Law 148/2019. Social insurance payments are deducted from the employer’s liability.',
  },
  JO: {
    country: 'JO',
    tiers: [
      { fromDay: 1, toDay: 14, payRate: 1 },
      { fromDay: 15, toDay: 28, payRate: 1 },
    ],
    citation: 'Jordan Labour Law No. 8 of 1996, Article 65 (as amended 2019)',
    sourceUrl:
      'https://www.mol.gov.jo/ebv4.0/root_storage/en/eb_list_page/final_labor_law_(with_2023_amendments)_qa_(2).pdf',
    verified: true,
    lastReviewed: '2026-08-28',
    notes:
      'Both tiers are at FULL pay — there is no reduced-pay tier in the current text, contrary to a common misconception. The first 14 days need a report from a physician approved by the firm; the second 14 days are conditional on the worker being an inpatient. In establishments of 20 or more workers the medical report must be approved by a medical committee. Whether a medical committee report is an alternative trigger to hospitalisation for the second tier is not fully settled and is worth confirming against the Arabic original.',
  },
};

export const PROBATION_RULES: Record<CountryCode, ProbationRule> = {
  SA: {
    country: 'SA',
    maxDays: 90,
    maxDaysWithExtension: 180,
    extensionRequiresConsent: true,
    citation: 'Saudi Labour Law, Article 53 (UNVERIFIED)',
    sourceUrl: 'https://www.hrsd.gov.sa/',
    verified: false,
    lastReviewed: '2026-08-28',
    notes: 'Working assumption: 90 days, extendable to 180 by written agreement.',
  },
  AE: {
    country: 'AE',
    maxDays: 180,
    maxDaysWithExtension: 180,
    extensionRequiresConsent: false,
    citation: 'UAE Federal Decree-Law 33/2021, Article 9',
    sourceUrl: 'https://uaelegislation.gov.ae/en/legislations/1541',
    verified: true,
    lastReviewed: '2026-08-28',
    notes:
      'Six months maximum, not extendable, and a worker may not be placed on probation more than once with the same employer. The employer must give at least 14 days written notice to terminate during probation; an employee moving to another UAE employer must give one month. Probation counts towards total service once passed.',
  },
  EG: {
    country: 'EG',
    maxDays: 90,
    maxDaysWithExtension: 90,
    extensionRequiresConsent: false,
    citation: 'Egypt Labour Law No. 14 of 2025, Article 90',
    sourceUrl: 'https://ar.wikisource.org/wiki/قانون_العمل_14_لسنة_2025_-_مصر',
    verified: true,
    lastReviewed: '2026-08-28',
    notes:
      'Three months maximum, and an employee may NOT be placed under probation more than once with the same employer — so no second probation on promotion, role change or re-hire. The contract must state the probation period.',
  },
  JO: {
    country: 'JO',
    maxDays: 90,
    maxDaysWithExtension: 90,
    extensionRequiresConsent: false,
    citation: 'Jordan Labour Law No. 8 of 1996, Article 35 (original 1996 text, never amended)',
    sourceUrl:
      'https://www.mol.gov.jo/ebv4.0/root_storage/en/eb_list_page/final_labor_law_(with_2023_amendments)_qa_(2).pdf',
    verified: true,
    lastReviewed: '2026-08-28',
    notes:
      'Three months maximum, with no extension or renewal mechanism in the article at all. Termination during probation needs no notice and pays no compensation. If the worker is kept on past probation the contract becomes indefinite-term and the probation counts towards total service.',
  },
};

export function leaveRuleFor(country: CountryCode, leaveType: LeaveType): LeaveRule | null {
  return LEAVE_RULES[country][leaveType] ?? null;
}

export function leaveTypesFor(country: CountryCode): LeaveType[] {
  return Object.keys(LEAVE_RULES[country]) as LeaveType[];
}
