/**
 * Shapes for the statutory rule tables.
 *
 * The calculators in `src/domain/` contain no country-specific branching at all.
 * Every jurisdictional difference is expressed as data in these tables, so adding
 * a fifth country is a data change and a wrong figure is a one-line fix with a
 * citation attached to it.
 */
import type { CountryCode, LeaveType, Provenance, SeparationReason } from '../types.js';

/**
 * One accrual band. `toYear: null` means "and everything above".
 * Rates are expressed in DAYS OF WAGE PER YEAR OF SERVICE, which lets a
 * "half a month per year" rule (KSA) and a "21 days per year" rule (UAE)
 * share a single engine.
 */
export interface AccrualBand {
  /** Inclusive lower bound, in years of service. */
  fromYear: number;
  /** Exclusive upper bound, in years of service. `null` for unbounded. */
  toYear: number | null;
  /** Days of wage accrued per year of service spent inside this band. */
  daysPerYear: number;
}

/** Multiplier applied to the accrued award, keyed by service length. */
export interface ReductionTier {
  fromYear: number;
  toYear: number | null;
  /** 0 = no entitlement, 0.5 = half, 1 = full. */
  multiplier: number;
}

export interface GratuityRule extends Provenance {
  country: CountryCode;
  /**
   * False where the jurisdiction has no employer-paid, per-year-of-service
   * gratuity in the ordinary case.
   *
   * This is not an edge case. In both Egypt and Jordan the Gulf-style gratuity
   * is displaced by the social insurance system for essentially the whole
   * private-sector workforce, and quoting an accrued figure to those employees
   * would be straightforwardly wrong. When this is false the calculator returns
   * no amount and explains what applies instead, rather than computing a number
   * nobody is owed.
   */
  hasStatutoryGratuity: boolean;
  /** What governs end of service instead, when `hasStatutoryGratuity` is false. */
  alternativeProvision?: { en: string; ar: string };
  /** Service below this many years earns nothing at all. */
  minimumServiceYears: number;
  /** Accrual bands, which must be contiguous and start at 0. */
  bands: AccrualBand[];
  /** Which wage figure the award is computed on. */
  wageBase: 'basic' | 'basic_plus_allowances';
  /** Divisor turning a monthly wage into a daily wage. Universally 30 here. */
  daysPerMonth: number;
  /** Statutory ceiling on the total award, in months of wage. `null` if uncapped. */
  capMonths: number | null;
  /**
   * Multipliers applied when the employee resigned. An empty array means
   * resignation is not penalised in this jurisdiction.
   */
  resignationTiers: ReductionTier[];
}

export interface LeaveRule extends Provenance {
  country: CountryCode;
  leaveType: LeaveType;
  /** Entitlement bands by years of service. `daysPerYear` here is days of LEAVE. */
  bands: Array<{ fromYear: number; toYear: number | null; days: number }>;
  /** Whether the statute counts calendar days or working days. */
  dayBasis: 'calendar' | 'working';
}

/** A tier of sick-leave pay: N days at P percent of wage. */
export interface SickLeaveTier {
  /** Day 1 of this tier, counted within a single leave year. */
  fromDay: number;
  /** Last day of this tier. `null` for unbounded. */
  toDay: number | null;
  /** Fraction of wage paid, 0 to 1. */
  payRate: number;
}

export interface SickLeaveRule extends Provenance {
  country: CountryCode;
  tiers: SickLeaveTier[];
}

export interface ProbationRule extends Provenance {
  country: CountryCode;
  /** Maximum initial probation, in days. */
  maxDays: number;
  /** Maximum total probation including any permitted extension, in days. */
  maxDaysWithExtension: number;
  /** Whether an extension requires the employee's written agreement. */
  extensionRequiresConsent: boolean;
}

/** Everything the calculators need in order to answer for one country. */
export interface CountryRuleSet {
  country: CountryCode;
  gratuity: GratuityRule;
  leave: Partial<Record<LeaveType, LeaveRule>>;
  sickLeave: SickLeaveRule;
  probation: ProbationRule;
}

export type SeparationKind = SeparationReason;
