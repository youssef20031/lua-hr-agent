/**
 * End-of-service gratuity calculator.
 *
 * Contains no country-specific logic: everything jurisdictional lives in the
 * `GratuityRule` passed in. The output carries a full step-by-step breakdown,
 * because an employee asking "what is my gratuity?" deserves to see the working,
 * and because an HR team can only trust a number it can check by hand.
 */
import type { GratuityRule } from './rules/schema.js';
import type { SeparationReason } from './types.js';
import { parseDate, serviceDuration, type ServiceDuration } from './date.js';

export interface GratuityInput {
  /** Monthly wage, on the basis the rule specifies (basic, or basic + allowances). */
  monthlyWage: number;
  /** ISO date the employee started. */
  hireDate: string;
  /** ISO date employment ends. */
  endDate: string;
  separationReason: SeparationReason;
}

export interface BandContribution {
  fromYear: number;
  toYear: number | null;
  /** Years of service that fell inside this band. */
  yearsInBand: number;
  daysPerYear: number;
  /** yearsInBand * daysPerYear */
  daysAccrued: number;
  amount: number;
}

export interface Bilingual {
  en: string;
  ar: string;
}

export interface GratuityBreakdownStep {
  label: Bilingual;
  detail: Bilingual;
  value?: number;
}

export interface GratuityResult {
  /** The final payable figure, rounded to 2dp. */
  amount: number;
  currency: string;
  service: ServiceDuration;
  /** Award before any resignation reduction, after any statutory cap. */
  grossAmount: number;
  /** Total days of wage accrued across all bands. */
  totalDaysAccrued: number;
  dailyWage: number;
  bands: BandContribution[];
  /** 1 when no reduction applied. */
  reductionMultiplier: number;
  /** True when the statutory ceiling bound the result. */
  capApplied: boolean;
  /** True when service fell below the minimum qualifying period. */
  belowMinimumService: boolean;
  /**
   * True where the jurisdiction has no employer-paid per-year gratuity at all.
   * `amount` is 0 and `alternativeProvision` says what governs instead.
   */
  notApplicable: boolean;
  alternativeProvision?: Bilingual;
  breakdown: GratuityBreakdownStep[];
  rule: {
    country: string;
    citation: string;
    sourceUrl: string;
    verified: boolean;
    wageBase: string;
  };
  /** Present when the underlying rule row is not yet source-verified. */
  warning?: Bilingual;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function fmt(n: number): string {
  return round2(n).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Splits total service across the accrual bands.
 * A person with 8.5 years under a 0-5 / 5+ rule contributes 5 years to the
 * first band and 3.5 to the second.
 */
export function splitAcrossBands(
  totalYears: number,
  bands: GratuityRule['bands'],
): Array<{ band: GratuityRule['bands'][number]; yearsInBand: number }> {
  return bands.map((band) => {
    const upper = band.toYear ?? Number.POSITIVE_INFINITY;
    const yearsInBand = Math.max(0, Math.min(totalYears, upper) - band.fromYear);
    return { band, yearsInBand };
  });
}

/** Finds the reduction multiplier for a given service length. Defaults to 1. */
export function reductionFor(totalYears: number, rule: GratuityRule): number {
  if (rule.resignationTiers.length === 0) return 1;
  for (const tier of rule.resignationTiers) {
    const upper = tier.toYear ?? Number.POSITIVE_INFINITY;
    if (totalYears >= tier.fromYear && totalYears < upper) return tier.multiplier;
  }
  return 1;
}

export function calculateGratuity(
  input: GratuityInput,
  rule: GratuityRule,
  currency = 'SAR',
): GratuityResult {
  if (!Number.isFinite(input.monthlyWage) || input.monthlyWage < 0) {
    throw new Error(
      `Monthly wage must be a non-negative number, received ${String(input.monthlyWage)}.`,
    );
  }

  const service = serviceDuration(parseDate(input.hireDate), parseDate(input.endDate));
  const years = service.decimalYears;
  const dailyWage = input.monthlyWage / rule.daysPerMonth;

  const breakdown: GratuityBreakdownStep[] = [];

  // Some jurisdictions simply do not have an employer-paid per-year gratuity.
  // Returning zero with an explanation is the honest answer; computing an
  // accrual and presenting it would tell the employee they are owed money they
  // are not owed.
  if (!rule.hasStatutoryGratuity) {
    breakdown.push({
      label: { en: 'No statutory gratuity', ar: 'لا يوجد بدل نهاية خدمة نظامي' },
      detail: rule.alternativeProvision ?? {
        en: `${rule.country} does not provide an employer-paid end-of-service gratuity accruing per year of service.`,
        ar: `لا تنص أنظمة ${rule.country} على بدل نهاية خدمة يدفعه صاحب العمل ويُحتسب عن كل سنة خدمة.`,
      },
      value: 0,
    });
    return {
      amount: 0,
      currency,
      service,
      grossAmount: 0,
      totalDaysAccrued: 0,
      dailyWage: round2(dailyWage),
      bands: [],
      reductionMultiplier: 0,
      capApplied: false,
      belowMinimumService: false,
      notApplicable: true,
      ...(rule.alternativeProvision ? { alternativeProvision: rule.alternativeProvision } : {}),
      breakdown,
      rule: ruleMeta(rule),
      ...(rule.verified ? {} : { warning: unverifiedWarning(rule) }),
    };
  }

  breakdown.push({
    label: { en: 'Length of service', ar: 'مدة الخدمة' },
    detail: {
      en: `${service.years} years, ${service.months} months, ${service.days} days (${service.totalDays} days total, ${years.toFixed(4)} years)`,
      ar: `${service.years} سنة و${service.months} شهر و${service.days} يوم (${service.totalDays} يوماً، ${years.toFixed(4)} سنة)`,
    },
    value: round2(years),
  });

  breakdown.push({
    label: { en: 'Daily wage', ar: 'الأجر اليومي' },
    detail: {
      en: `${fmt(input.monthlyWage)} ${currency} per month divided by ${rule.daysPerMonth} days = ${fmt(dailyWage)} ${currency} per day`,
      ar: `${fmt(input.monthlyWage)} ${currency} شهرياً ÷ ${rule.daysPerMonth} يوم = ${fmt(dailyWage)} ${currency} يومياً`,
    },
    value: round2(dailyWage),
  });

  // Below the qualifying period, nothing is owed at all.
  if (years < rule.minimumServiceYears) {
    breakdown.push({
      label: { en: 'Minimum service not met', ar: 'لم تكتمل مدة الخدمة الدنيا' },
      detail: {
        en: `Service of ${years.toFixed(2)} years is below the ${rule.minimumServiceYears}-year qualifying period, so no gratuity is payable.`,
        ar: `مدة الخدمة ${years.toFixed(2)} سنة أقل من الحد الأدنى ${rule.minimumServiceYears} سنة، لذلك لا يُستحق بدل نهاية الخدمة.`,
      },
      value: 0,
    });
    return {
      amount: 0,
      currency,
      service,
      grossAmount: 0,
      totalDaysAccrued: 0,
      dailyWage: round2(dailyWage),
      bands: [],
      reductionMultiplier: 0,
      capApplied: false,
      belowMinimumService: true,
      notApplicable: false,
      breakdown,
      rule: ruleMeta(rule),
      ...(rule.verified ? {} : { warning: unverifiedWarning(rule) }),
    };
  }

  const split = splitAcrossBands(years, rule.bands);
  const bands: BandContribution[] = split.map(({ band, yearsInBand }) => {
    const daysAccrued = yearsInBand * band.daysPerYear;
    return {
      fromYear: band.fromYear,
      toYear: band.toYear,
      yearsInBand,
      daysPerYear: band.daysPerYear,
      daysAccrued,
      amount: daysAccrued * dailyWage,
    };
  });

  for (const b of bands) {
    if (b.yearsInBand <= 0) continue;
    const range =
      b.toYear === null ? `beyond year ${b.fromYear}` : `years ${b.fromYear} to ${b.toYear}`;
    const rangeAr =
      b.toYear === null ? `ما بعد السنة ${b.fromYear}` : `السنوات ${b.fromYear} إلى ${b.toYear}`;
    breakdown.push({
      label: { en: `Accrual for ${range}`, ar: `الاستحقاق عن ${rangeAr}` },
      detail: {
        en: `${b.yearsInBand.toFixed(4)} years x ${b.daysPerYear} days/year = ${b.daysAccrued.toFixed(2)} days x ${fmt(dailyWage)} = ${fmt(b.amount)} ${currency}`,
        ar: `${b.yearsInBand.toFixed(4)} سنة × ${b.daysPerYear} يوم/سنة = ${b.daysAccrued.toFixed(2)} يوم × ${fmt(dailyWage)} = ${fmt(b.amount)} ${currency}`,
      },
      value: round2(b.amount),
    });
  }

  const totalDaysAccrued = bands.reduce((sum, b) => sum + b.daysAccrued, 0);
  let gross = bands.reduce((sum, b) => sum + b.amount, 0);

  breakdown.push({
    label: { en: 'Gross award', ar: 'إجمالي المكافأة' },
    detail: {
      en: `${totalDaysAccrued.toFixed(2)} days of wage = ${fmt(gross)} ${currency}`,
      ar: `${totalDaysAccrued.toFixed(2)} يوم أجر = ${fmt(gross)} ${currency}`,
    },
    value: round2(gross),
  });

  // Statutory ceiling, applied before any resignation reduction.
  let capApplied = false;
  if (rule.capMonths !== null) {
    const ceiling = rule.capMonths * input.monthlyWage;
    if (gross > ceiling) {
      capApplied = true;
      breakdown.push({
        label: { en: 'Statutory cap applied', ar: 'تطبيق الحد الأقصى النظامي' },
        detail: {
          en: `Award capped at ${rule.capMonths} months of wage: ${fmt(gross)} becomes ${fmt(ceiling)} ${currency}`,
          ar: `تم تحديد المكافأة بحد أقصى ${rule.capMonths} شهر من الأجر: ${fmt(gross)} تصبح ${fmt(ceiling)} ${currency}`,
        },
        value: round2(ceiling),
      });
      gross = ceiling;
    }
  }

  // Resignation reduction, where the jurisdiction imposes one.
  const isResignation = input.separationReason === 'resignation';
  const multiplier = isResignation ? reductionFor(years, rule) : 1;

  if (isResignation && rule.resignationTiers.length > 0) {
    breakdown.push({
      label: { en: 'Resignation adjustment', ar: 'تعديل الاستقالة' },
      detail: {
        en:
          multiplier === 1
            ? `Service of ${years.toFixed(2)} years qualifies for the full award on resignation.`
            : multiplier === 0
              ? `Service of ${years.toFixed(2)} years is below the threshold, so no award is payable on resignation.`
              : `Service of ${years.toFixed(2)} years entitles the employee to ${formatFraction(multiplier)} of the award on resignation.`,
        ar:
          multiplier === 1
            ? `مدة الخدمة ${years.toFixed(2)} سنة تستحق المكافأة كاملة عند الاستقالة.`
            : multiplier === 0
              ? `مدة الخدمة ${years.toFixed(2)} سنة أقل من الحد المطلوب، فلا تُستحق مكافأة عند الاستقالة.`
              : `مدة الخدمة ${years.toFixed(2)} سنة تستحق ${formatFractionAr(multiplier)} المكافأة عند الاستقالة.`,
      },
      value: multiplier,
    });
  }

  const amount = round2(gross * multiplier);

  breakdown.push({
    label: { en: 'Total payable', ar: 'الإجمالي المستحق' },
    detail: {
      en:
        multiplier === 1
          ? `Total payable: ${fmt(amount)} ${currency}`
          : `${fmt(gross)} x ${formatMultiplier(multiplier)} = ${fmt(amount)} ${currency}`,
      // An all-numeric Arabic line reads as untranslated. Every step must carry
      // real Arabic, including the one the employee actually looks at.
      ar:
        multiplier === 1
          ? `الإجمالي المستحق: ${fmt(amount)} ${currencyAr(currency)}`
          : `${fmt(gross)} × ${formatMultiplier(multiplier)} = ${fmt(amount)} ${currencyAr(currency)}`,
    },
    value: amount,
  });

  return {
    amount,
    currency,
    service,
    grossAmount: round2(gross),
    totalDaysAccrued: round2(totalDaysAccrued),
    dailyWage: round2(dailyWage),
    bands: bands.map((b) => ({
      ...b,
      amount: round2(b.amount),
      daysAccrued: round2(b.daysAccrued),
    })),
    reductionMultiplier: multiplier,
    capApplied,
    belowMinimumService: false,
    notApplicable: false,
    breakdown,
    rule: ruleMeta(rule),
    ...(rule.verified ? {} : { warning: unverifiedWarning(rule) }),
  };
}

function ruleMeta(rule: GratuityRule): GratuityResult['rule'] {
  return {
    country: rule.country,
    citation: rule.citation,
    sourceUrl: rule.sourceUrl,
    verified: rule.verified,
    wageBase: rule.wageBase,
  };
}

function unverifiedWarning(rule: GratuityRule): Bilingual {
  return {
    en: `This estimate uses a rule for ${rule.country} that has not been confirmed against a primary legal source. Treat it as indicative and confirm with HR before relying on it.`,
    ar: `هذا التقدير يستند إلى قاعدة خاصة بـ ${rule.country} لم يتم التحقق منها من مصدر قانوني أساسي. يُرجى اعتباره استرشادياً والتأكد من الموارد البشرية قبل الاعتماد عليه.`,
  };
}

/** Currency names in Arabic, so an Arabic line never ends in a Latin code. */
function currencyAr(currency: string): string {
  const names: Record<string, string> = {
    SAR: 'ريال',
    AED: 'درهم',
    EGP: 'جنيه',
    JOD: 'دينار',
  };
  return names[currency] ?? currency;
}

/**
 * The multiplier as it appears in the arithmetic line.
 *
 * Rounded to three decimals it does not reproduce the total — 0.667 of the
 * gross is out by tens of riyals — and this line exists precisely so that an
 * employee or an HR officer can redo the sum by hand and get the same answer.
 * The statutory tiers are exact fractions, so print them as fractions.
 */
function formatMultiplier(m: number): string {
  if (Math.abs(m - 1 / 3) < 1e-9) return '1/3';
  if (Math.abs(m - 2 / 3) < 1e-9) return '2/3';
  if (Math.abs(m - 0.5) < 1e-9) return '1/2';
  return String(Number(m.toFixed(6)));
}

function formatFraction(m: number): string {
  if (Math.abs(m - 1 / 3) < 1e-9) return 'one third';
  if (Math.abs(m - 2 / 3) < 1e-9) return 'two thirds';
  if (Math.abs(m - 0.5) < 1e-9) return 'one half';
  return `${(m * 100).toFixed(0)} percent`;
}

function formatFractionAr(m: number): string {
  if (Math.abs(m - 1 / 3) < 1e-9) return 'ثلث';
  if (Math.abs(m - 2 / 3) < 1e-9) return 'ثلثي';
  if (Math.abs(m - 0.5) < 1e-9) return 'نصف';
  return `${(m * 100).toFixed(0)}% من`;
}
