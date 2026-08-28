/**
 * End-of-service rules, one row per country.
 *
 * PROVENANCE POLICY
 * -----------------
 * `verified: true` means the figure was checked against the statutory text or a
 * strong corroborating source during this build, and `sourceUrl` supports it.
 * `verified: false` means it has NOT been confirmed. The calculator attaches a
 * visible warning to any result derived from an unverified row and the agent
 * passes that warning to the employee. Do not flip a flag without checking.
 *
 * THE BIG STRUCTURAL POINT
 * ------------------------
 * Only two of these four countries have a Gulf-style employer-paid gratuity
 * accruing per year of service. In Egypt and Jordan it is displaced by the
 * social insurance system for essentially the entire private-sector workforce.
 * Those rows carry `hasStatutoryGratuity: false`, and the calculator returns no
 * figure for them rather than inventing an accrual nobody is owed.
 *
 * Accrual rates are DAYS OF WAGE PER YEAR OF SERVICE. "Half a month per year"
 * is 15 days, "a full month per year" is 30. That lets the Saudi and Emirati
 * formulations share one engine.
 */
import type { CountryCode } from '../types.js';
import type { GratuityRule } from './schema.js';

export const GRATUITY_RULES: Record<CountryCode, GratuityRule> = {
  /**
   * Saudi Arabia — Labour Law Articles 84 and 85. VERIFIED.
   *
   * Article 84: half a month's wage for each of the first five years, a full
   * month's wage for each year thereafter, on the LAST WAGE, pro-rated for part
   * of a year.
   *
   * Wage base matters and is easy to get wrong: Article 84 refers to the "wage"
   * (الأجر), which under the Labour Law's definitions is basic wage plus regular
   * allowances, not basic salary alone. Using basic alone understates every
   * award, often by a third or more.
   */
  SA: {
    country: 'SA',
    hasStatutoryGratuity: true,
    minimumServiceYears: 0,
    bands: [
      { fromYear: 0, toYear: 5, daysPerYear: 15 },
      { fromYear: 5, toYear: null, daysPerYear: 30 },
    ],
    wageBase: 'basic_plus_allowances',
    daysPerMonth: 30,
    capMonths: null,
    // Article 85: resignation reduces the award on a sliding scale.
    resignationTiers: [
      { fromYear: 0, toYear: 2, multiplier: 0 },
      { fromYear: 2, toYear: 5, multiplier: 1 / 3 },
      { fromYear: 5, toYear: 10, multiplier: 2 / 3 },
      { fromYear: 10, toYear: null, multiplier: 1 },
    ],
    citation: 'Saudi Labour Law, Articles 84 and 85',
    sourceUrl: 'https://etqanlawfirm-sa.com/en/article-84-saudi-labor-law/',
    verified: true,
    lastReviewed: '2026-08-28',
    notes:
      'Computed on the last wage including regular allowances. Termination, contract expiry, death and total disability pay the full award; only resignation is reduced, under Article 85.',
  },

  /**
   * United Arab Emirates — Federal Decree-Law 33/2021, Article 51. VERIFIED
   * against the consolidated official text, which incorporates the 2022, 2023
   * and 2024 amendments.
   *
   * 21 days of basic wage per year for the first five years, 30 days per year
   * thereafter, on the LAST BASIC WAGE — allowances such as housing and
   * transport are expressly excluded, which is the opposite of the Saudi
   * position and the easiest cross-border mistake to make.
   *
   * Resignation does NOT reduce the award. The old one-third and two-thirds
   * tiers lived in Federal Law 8/1980, which Article 73(1) repeals outright, and
   * Article 51 draws no distinction between resigning and being terminated. Nor
   * is there any forfeiture for dismissal under Article 44: unlike the former
   * regime, the 2021 law contains no gratuity-forfeiture clause. The only
   * permitted deduction is a set-off of amounts due by law or judgment under
   * Article 51(7).
   *
   * Article 67 fixes a year at 365 days and a month at 30 days, which is the
   * statutory basis for the daily-wage divisor used here.
   */
  AE: {
    country: 'AE',
    hasStatutoryGratuity: true,
    minimumServiceYears: 1,
    bands: [
      { fromYear: 0, toYear: 5, daysPerYear: 21 },
      { fromYear: 5, toYear: null, daysPerYear: 30 },
    ],
    wageBase: 'basic',
    daysPerMonth: 30,
    // Article 51(6). The cap binds only at roughly 26 years of service, so it
    // is rarely reached in practice.
    capMonths: 24,
    resignationTiers: [],
    citation: 'UAE Federal Decree-Law 33/2021, Articles 51 and 67',
    sourceUrl: 'https://uaelegislation.gov.ae/en/legislations/1541',
    verified: true,
    lastReviewed: '2026-08-28',
    notes:
      'Computed on the last BASIC wage, excluding housing, transport and similar allowances. Two carve-outs are not modelled: employees enrolled in the opt-in Savings Scheme (Cabinet Resolution 96/2023) accrue employer contributions instead of a gratuity, and Article 68(3) lets legacy indefinite-term contracts predating February 2022 be computed under the old law. Flag long-tenure pre-2022 hires for manual review. All entitlements are payable within 14 days of contract end under Article 53.',
  },

  /**
   * Egypt — Labour Law No. 14 of 2025, Article 172. VERIFIED.
   *
   * Law 14/2025 was published in the Official Gazette on 3 May 2025 and took
   * effect on 1 September 2025, repealing Law 12/2003. Any guidance still
   * citing Law 12/2003 is out of date.
   *
   * Article 172 is a residual gap-filler, not a general entitlement: a gratuity
   * arises only where the social insurance system does NOT apply, or in respect
   * of the portion of wage falling outside the insurance contribution wage. For
   * a normally-insured private-sector employee, no employer gratuity is owed.
   *
   * What an employee actually receives instead is their social insurance
   * entitlement, plus payment for accrued annual leave (Article 125, settled for
   * up to three years of balance). Where a dismissal is for an unlawful cause,
   * Article 165 gives damages of not less than two months' wage per year of
   * service — which is compensation for unlawful termination, NOT severance for
   * any termination, a distinction several English summaries blur.
   */
  EG: {
    country: 'EG',
    hasStatutoryGratuity: false,
    alternativeProvision: {
      en:
        'Egypt has no employer-paid end-of-service gratuity accruing per year of service. ' +
        'Under Labour Law 14/2025 (Article 172) a gratuity arises only where the social insurance ' +
        'system does not apply. End of service is provided through social insurance, plus payment ' +
        'for accrued annual leave. Where a dismissal is for an unlawful cause, Article 165 gives ' +
        'damages of at least two months’ wage per year of service. HR must confirm your position.',
      ar:
        'لا يوجد في مصر بدل نهاية خدمة يدفعه صاحب العمل ويُحتسب عن كل سنة خدمة. ووفقاً لقانون العمل ١٤ لسنة ٢٠٢٥ (المادة ١٧٢) لا تُستحق المكافأة إلا في الحالات التي لا يسري فيها نظام التأمينات الاجتماعية. وتتم تسوية نهاية الخدمة عبر التأمينات الاجتماعية، إضافة إلى المقابل النقدي لرصيد الإجازات. وفي حالة الفصل لسبب غير مشروع تنص المادة ١٦٥ على تعويض لا يقل عن أجر شهرين عن كل سنة خدمة. يُرجى مراجعة الموارد البشرية.',
    },
    minimumServiceYears: 0,
    bands: [{ fromYear: 0, toYear: null, daysPerYear: 0 }],
    wageBase: 'basic_plus_allowances',
    daysPerMonth: 30,
    capMonths: null,
    resignationTiers: [],
    citation: 'Egypt Labour Law No. 14 of 2025, Article 172 (in force 1 September 2025)',
    sourceUrl: 'https://ar.wikisource.org/wiki/قانون_العمل_14_لسنة_2025_-_مصر',
    verified: true,
    lastReviewed: '2026-08-28',
    notes:
      'One narrow exception exists: Article 154 gives one month’s wage per year where a fixed-term contract running beyond five years is terminated by the employer after that point. Not modelled here. Verified against the statutory text; a spot-check against the Official Gazette PDF is still advisable.',
  },

  /**
   * Jordan — Labour Law No. 8 of 1996, Article 32, as amended. VERIFIED.
   *
   * Article 32 opens with a carve-out: the one-month-per-year end-of-service
   * remuneration is owed only to a worker who is NOT subject to the Social
   * Security Law. Social Security Corporation coverage is compulsory and
   * effectively universal — Social Security Law 1/2014 Article 4(a) covers all
   * workers subject to the Labour Law aged 16 or over regardless of contract
   * type, and Article 2(b) defines a covered firm as one employing one or more
   * workers, so there is no size threshold.
   *
   * The practical result: for a normal private-sector employee, no employer-paid
   * gratuity is owed, on resignation or termination alike. The residual class is
   * narrow — irregular workers (fewer than 16 days a month), those on
   * civil/military retirement schemes, and non-Jordanians at foreign missions.
   *
   * Separately, Article 25 (amended by Law 14/2019) gives compensation for
   * arbitrary dismissal of half a month's wage per year of service, subject to a
   * floor of two months' wages. The widely-quoted "three to six months" figure
   * is the superseded pre-2019 value.
   */
  JO: {
    country: 'JO',
    hasStatutoryGratuity: false,
    alternativeProvision: {
      en:
        'Jordan’s end-of-service gratuity under Article 32 applies only to workers not covered by ' +
        'the Social Security Corporation, and SSC coverage is compulsory for essentially all ' +
        'private-sector employees. For a normal employee no employer-paid gratuity is owed on ' +
        'leaving, whether they resign or are terminated; the entitlement is their SSC pension or ' +
        'lump sum. Where a dismissal is arbitrary, Article 25 gives half a month’s wage per year ' +
        'of service, with a floor of two months’ wages. HR must confirm your position.',
      ar:
        'ينطبق بدل نهاية الخدمة في الأردن بموجب المادة ٣٢ فقط على العاملين غير الخاضعين لقانون الضمان الاجتماعي، والشمول بالضمان إلزامي لجميع العاملين في القطاع الخاص تقريباً. لذلك لا يُستحق بدل نهاية خدمة من صاحب العمل للموظف الاعتيادي، سواء استقال أو أُنهيت خدمته، ويكون الاستحقاق من خلال الضمان الاجتماعي. وفي حالة الفصل التعسفي تنص المادة ٢٥ على تعويض بنصف أجر شهر عن كل سنة خدمة بحد أدنى أجر شهرين. يُرجى مراجعة الموارد البشرية.',
    },
    minimumServiceYears: 0,
    bands: [{ fromYear: 0, toYear: null, daysPerYear: 0 }],
    wageBase: 'basic_plus_allowances',
    daysPerMonth: 30,
    capMonths: null,
    resignationTiers: [],
    citation: 'Jordan Labour Law No. 8 of 1996, Article 32 (as amended to 2023); Social Security Law No. 1 of 2014, Article 4(a)',
    sourceUrl:
      'https://www.mol.gov.jo/ebv4.0/root_storage/en/eb_list_page/final_labor_law_(with_2023_amendments)_qa_(2).pdf',
    verified: true,
    lastReviewed: '2026-08-28',
    notes:
      'Article 32 pays one month’s wage per year of service, on the last wage, but only to the residual class outside SSC coverage. If the employer has any such staff, model them separately rather than flipping this row.',
  },
};

/** Local currency per country, used for presenting amounts. */
export const CURRENCIES: Record<CountryCode, string> = {
  SA: 'SAR',
  AE: 'AED',
  EG: 'EGP',
  JO: 'JOD',
};

export function gratuityRuleFor(country: CountryCode): GratuityRule {
  return GRATUITY_RULES[country];
}

/** Countries whose end-of-service rule has been source-verified. */
export function verifiedGratuityCountries(): CountryCode[] {
  return (Object.keys(GRATUITY_RULES) as CountryCode[]).filter((c) => GRATUITY_RULES[c].verified);
}

/** Countries that actually have an employer-paid per-year gratuity. */
export function countriesWithGratuity(): CountryCode[] {
  return (Object.keys(GRATUITY_RULES) as CountryCode[]).filter(
    (c) => GRATUITY_RULES[c].hasStatutoryGratuity,
  );
}
