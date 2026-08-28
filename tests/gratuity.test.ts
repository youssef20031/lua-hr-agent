import { describe, it, expect } from 'vitest';
import {
  calculateGratuity,
  reductionFor,
  splitAcrossBands,
} from '../src/domain/gratuity.js';
import { GRATUITY_RULES, gratuityRuleFor } from '../src/domain/rules/gratuity.js';
import type { GratuityRule } from '../src/domain/rules/schema.js';

const KSA = gratuityRuleFor('SA');
const UAE = gratuityRuleFor('AE');

describe('splitAcrossBands', () => {
  it('puts all service in the first band when below the boundary', () => {
    const split = splitAcrossBands(3, KSA.bands);
    expect(split[0]!.yearsInBand).toBe(3);
    expect(split[1]!.yearsInBand).toBe(0);
  });

  it('caps the first band and spills the remainder into the second', () => {
    const split = splitAcrossBands(8.5, KSA.bands);
    expect(split[0]!.yearsInBand).toBe(5);
    expect(split[1]!.yearsInBand).toBeCloseTo(3.5, 10);
  });

  it('handles service exactly on the boundary', () => {
    const split = splitAcrossBands(5, KSA.bands);
    expect(split[0]!.yearsInBand).toBe(5);
    expect(split[1]!.yearsInBand).toBe(0);
  });

  it('handles zero service', () => {
    const split = splitAcrossBands(0, KSA.bands);
    expect(split.every((s) => s.yearsInBand === 0)).toBe(true);
  });

  it('conserves total years across bands', () => {
    for (const years of [0.5, 1, 4.999, 5, 5.001, 12.75, 40]) {
      const total = splitAcrossBands(years, KSA.bands).reduce((s, b) => s + b.yearsInBand, 0);
      expect(total).toBeCloseTo(years, 10);
    }
  });
});

describe('reductionFor — KSA Article 85 resignation tiers', () => {
  // Boundaries are the whole point of this table, so they are tested exactly.
  it('pays nothing below two years', () => {
    expect(reductionFor(0, KSA)).toBe(0);
    expect(reductionFor(1.99, KSA)).toBe(0);
  });

  it('pays one third from exactly two years', () => {
    expect(reductionFor(2, KSA)).toBeCloseTo(1 / 3, 10);
    expect(reductionFor(4.999, KSA)).toBeCloseTo(1 / 3, 10);
  });

  it('pays two thirds from exactly five years', () => {
    expect(reductionFor(5, KSA)).toBeCloseTo(2 / 3, 10);
    expect(reductionFor(9.999, KSA)).toBeCloseTo(2 / 3, 10);
  });

  it('pays in full from exactly ten years', () => {
    expect(reductionFor(10, KSA)).toBe(1);
    expect(reductionFor(35, KSA)).toBe(1);
  });

  it('returns 1 for a jurisdiction with no resignation tiers', () => {
    expect(reductionFor(3, UAE)).toBe(1);
  });
});

describe('calculateGratuity — KSA, hand-worked', () => {
  // 12,000 SAR/month, 1 March 2018 to 1 March 2026 = 2,922 days = 8.0055 years.
  // Daily wage 400. Band 1: 5 x 15 = 75 days = 30,000.
  // Band 2: 3.00548 x 30 = 90.164 days = 36,065.75. Gross = 66,065.75.
  const base = {
    monthlyWage: 12_000,
    hireDate: '2018-03-01',
    endDate: '2026-03-01',
  };

  it('computes service length exactly', () => {
    const r = calculateGratuity({ ...base, separationReason: 'termination' }, KSA);
    expect(r.service.totalDays).toBe(2922);
    expect(r.service.years).toBe(8);
    expect(r.service.months).toBe(0);
    expect(r.service.days).toBe(0);
  });

  it('derives the daily wage from a 30-day month', () => {
    const r = calculateGratuity({ ...base, separationReason: 'termination' }, KSA);
    expect(r.dailyWage).toBe(400);
  });

  it('accrues half a month per year for the first five years', () => {
    const r = calculateGratuity({ ...base, separationReason: 'termination' }, KSA);
    expect(r.bands[0]!.daysAccrued).toBe(75);
    expect(r.bands[0]!.amount).toBe(30_000);
  });

  it('accrues a full month per year beyond five years', () => {
    const r = calculateGratuity({ ...base, separationReason: 'termination' }, KSA);
    expect(r.bands[1]!.yearsInBand).toBeCloseTo(3.00548, 4);
    expect(r.bands[1]!.amount).toBeCloseTo(36_065.75, 2);
  });

  it('pays the full gross award on termination', () => {
    const r = calculateGratuity({ ...base, separationReason: 'termination' }, KSA);
    expect(r.amount).toBeCloseTo(66_065.75, 2);
    expect(r.reductionMultiplier).toBe(1);
  });

  it('pays two thirds on resignation at eight years of service', () => {
    const r = calculateGratuity({ ...base, separationReason: 'resignation' }, KSA);
    expect(r.reductionMultiplier).toBeCloseTo(2 / 3, 10);
    expect(r.amount).toBeCloseTo(44_043.84, 2);
  });

  // The breakdown exists so an employee or an HR officer can re-do the sum by
  // hand. A multiplier printed as a rounded decimal breaks that: 0.667 applied
  // to the printed gross does not give the printed total.
  it('prints a multiplier that reproduces the printed total by hand', () => {
    const r = calculateGratuity({ ...base, separationReason: 'resignation' }, KSA);
    const detail = r.breakdown.at(-1)!.detail.en;
    const m = /([\d,]+\.\d{2})\s*x\s*(\S+)\s*=\s*([\d,]+\.\d{2})/.exec(detail);
    expect(m, `could not parse the total line: ${detail}`).not.toBeNull();
    const num = (v: string): number => Number(v.replace(/,/g, ''));
    const shown = m![2]!;
    const multiplier = shown.includes('/')
      ? Number(shown.split('/')[0]) / Number(shown.split('/')[1])
      : Number(shown);
    // Within a cent: the printed total is rounded to the cent, so re-doing the
    // sum from the printed figures lands a fraction of a cent away. The bug this
    // guards against printed 0.667 and was out by 22 riyals.
    expect(Math.abs(num(m![1]!) * multiplier - num(m![3]!))).toBeLessThan(0.01);
  });

  it('pays the full award on contract expiry, not the resignation fraction', () => {
    const r = calculateGratuity({ ...base, separationReason: 'end_of_contract' }, KSA);
    expect(r.amount).toBeCloseTo(66_065.75, 2);
  });

  it('pays the full award on death or total disability', () => {
    const r = calculateGratuity({ ...base, separationReason: 'force_majeure' }, KSA);
    expect(r.amount).toBeCloseTo(66_065.75, 2);
  });
});

describe('calculateGratuity — KSA resignation edge cases', () => {
  it('pays nothing to someone resigning at 18 months', () => {
    const r = calculateGratuity(
      {
        monthlyWage: 10_000,
        hireDate: '2024-01-01',
        endDate: '2025-07-01',
        separationReason: 'resignation',
      },
      KSA,
    );
    expect(r.amount).toBe(0);
    expect(r.reductionMultiplier).toBe(0);
  });

  it('still pays a terminated employee at 18 months', () => {
    const r = calculateGratuity(
      {
        monthlyWage: 10_000,
        hireDate: '2024-01-01',
        endDate: '2025-07-01',
        separationReason: 'termination',
      },
      KSA,
    );
    expect(r.amount).toBeGreaterThan(0);
  });

  it('pro-rates a partial year rather than rounding it away', () => {
    const half = calculateGratuity(
      {
        monthlyWage: 12_000,
        hireDate: '2025-01-01',
        endDate: '2025-07-02',
        separationReason: 'termination',
      },
      KSA,
    );
    // 182 days = 0.4986 years x 15 days x 400 = about 2,992.
    expect(half.amount).toBeGreaterThan(2_900);
    expect(half.amount).toBeLessThan(3_050);
  });

  it('returns zero for zero service', () => {
    const r = calculateGratuity(
      {
        monthlyWage: 12_000,
        hireDate: '2026-01-01',
        endDate: '2026-01-01',
        separationReason: 'termination',
      },
      KSA,
    );
    expect(r.amount).toBe(0);
  });
});

describe('calculateGratuity — UAE minimum service and cap', () => {
  it('pays nothing below the one-year qualifying period', () => {
    const r = calculateGratuity(
      {
        monthlyWage: 20_000,
        hireDate: '2025-06-01',
        endDate: '2026-01-01',
        separationReason: 'termination',
      },
      UAE,
      'AED',
    );
    expect(r.amount).toBe(0);
    expect(r.belowMinimumService).toBe(true);
  });

  it('applies the two-year wage ceiling on very long service', () => {
    const r = calculateGratuity(
      {
        monthlyWage: 20_000,
        hireDate: '1985-01-01',
        endDate: '2026-01-01',
        separationReason: 'termination',
      },
      UAE,
      'AED',
    );
    expect(r.capApplied).toBe(true);
    expect(r.amount).toBe(480_000); // 24 months x 20,000
  });

  it('does not reduce a UAE award on resignation', () => {
    const r = calculateGratuity(
      {
        monthlyWage: 20_000,
        hireDate: '2023-01-01',
        endDate: '2026-01-01',
        separationReason: 'resignation',
      },
      UAE,
      'AED',
    );
    expect(r.reductionMultiplier).toBe(1);
  });
});

describe('provenance safety net', () => {
  it('attaches no warning to a source-verified rule', () => {
    const r = calculateGratuity(
      {
        monthlyWage: 10_000,
        hireDate: '2020-01-01',
        endDate: '2026-01-01',
        separationReason: 'termination',
      },
      KSA,
    );
    expect(KSA.verified).toBe(true);
    expect(r.warning).toBeUndefined();
  });

  // The warning mechanism is tested against a SYNTHETIC unverified rule rather
  // than whichever country happens to be unverified today. Every real row is
  // now source-verified, and a test that depended on that would break the
  // moment someone did the right thing and verified another one.
  const unverifiedRule: GratuityRule = {
    ...KSA,
    country: 'SA',
    citation: 'Synthetic rule for testing (UNVERIFIED)',
    verified: false,
  };

  it('warns on every result derived from an unverified rule', () => {
    const r = calculateGratuity(
      {
        monthlyWage: 10_000,
        hireDate: '2020-01-01',
        endDate: '2026-01-01',
        separationReason: 'termination',
      },
      unverifiedRule,
    );
    expect(r.warning).toBeDefined();
    expect(r.warning!.ar).toMatch(/[؀-ۿ]/);
  });

  it('warns even when the unverified rule pays nothing', () => {
    const r = calculateGratuity(
      {
        monthlyWage: 10_000,
        hireDate: '2025-11-01',
        endDate: '2026-01-01',
        separationReason: 'resignation',
      },
      unverifiedRule,
    );
    expect(r.amount).toBe(0);
    expect(r.warning).toBeDefined();
  });

  it('has every real gratuity rule source-verified', () => {
    for (const rule of Object.values(GRATUITY_RULES)) {
      expect(rule.verified, `${rule.country} is no longer verified`).toBe(true);
    }
  });

  it('carries a citation on every rule row', () => {
    for (const rule of Object.values(GRATUITY_RULES)) {
      expect(rule.citation.length).toBeGreaterThan(0);
      expect(rule.sourceUrl).toMatch(/^https?:\/\//);
      expect(rule.lastReviewed).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('marks unverified citations as such in the citation text', () => {
    for (const rule of Object.values(GRATUITY_RULES)) {
      if (!rule.verified) {
        expect(rule.citation.toUpperCase()).toContain('UNVERIFIED');
      }
    }
  });
});

describe('breakdown output', () => {
  it('shows its working in both languages', () => {
    const r = calculateGratuity(
      {
        monthlyWage: 12_000,
        hireDate: '2018-03-01',
        endDate: '2026-03-01',
        separationReason: 'resignation',
      },
      KSA,
    );
    expect(r.breakdown.length).toBeGreaterThanOrEqual(5);
    for (const step of r.breakdown) {
      expect(step.label.en.length).toBeGreaterThan(0);
      expect(step.detail.en.length).toBeGreaterThan(0);
      // Arabic strings must contain Arabic script, not silently fall back to
      // English. The DETAIL matters as much as the label: a line reading
      // "66,065.75 x 0.667 = 44,043.84 SAR" is the one the employee actually
      // reads, and an all-numeric Arabic line looks untranslated.
      expect(step.label.ar, `label for "${step.label.en}"`).toMatch(/[؀-ۿ]/);
      expect(step.detail.ar, `detail for "${step.label.en}"`).toMatch(/[؀-ۿ]/);
    }
  });

  it('ends with the payable total matching the returned amount', () => {
    const r = calculateGratuity(
      {
        monthlyWage: 12_000,
        hireDate: '2018-03-01',
        endDate: '2026-03-01',
        separationReason: 'resignation',
      },
      KSA,
    );
    expect(r.breakdown.at(-1)!.value).toBe(r.amount);
  });
});

describe('input validation', () => {
  it('rejects a negative wage', () => {
    expect(() =>
      calculateGratuity(
        {
          monthlyWage: -1,
          hireDate: '2020-01-01',
          endDate: '2026-01-01',
          separationReason: 'termination',
        },
        KSA,
      ),
    ).toThrow(/non-negative/);
  });

  it('rejects a non-finite wage', () => {
    expect(() =>
      calculateGratuity(
        {
          monthlyWage: Number.NaN,
          hireDate: '2020-01-01',
          endDate: '2026-01-01',
          separationReason: 'termination',
        },
        KSA,
      ),
    ).toThrow(/non-negative/);
  });

  it('rejects an end date before the hire date', () => {
    expect(() =>
      calculateGratuity(
        {
          monthlyWage: 10_000,
          hireDate: '2026-01-01',
          endDate: '2020-01-01',
          separationReason: 'termination',
        },
        KSA,
      ),
    ).toThrow(/precedes hire date/);
  });
});

describe('rule table integrity', () => {
  const rules: GratuityRule[] = Object.values(GRATUITY_RULES);

  it('has contiguous bands starting at zero', () => {
    for (const rule of rules) {
      expect(rule.bands[0]!.fromYear, rule.country).toBe(0);
      for (let i = 1; i < rule.bands.length; i++) {
        expect(rule.bands[i]!.fromYear, rule.country).toBe(rule.bands[i - 1]!.toYear);
      }
      expect(rule.bands.at(-1)!.toYear, rule.country).toBeNull();
    }
  });

  it('has contiguous resignation tiers covering zero to infinity where present', () => {
    for (const rule of rules) {
      if (rule.resignationTiers.length === 0) continue;
      expect(rule.resignationTiers[0]!.fromYear, rule.country).toBe(0);
      for (let i = 1; i < rule.resignationTiers.length; i++) {
        expect(rule.resignationTiers[i]!.fromYear, rule.country).toBe(
          rule.resignationTiers[i - 1]!.toYear,
        );
      }
      expect(rule.resignationTiers.at(-1)!.toYear, rule.country).toBeNull();
    }
  });

  it('uses multipliers within zero and one', () => {
    for (const rule of rules) {
      for (const tier of rule.resignationTiers) {
        expect(tier.multiplier).toBeGreaterThanOrEqual(0);
        expect(tier.multiplier).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('jurisdictions with no statutory gratuity', () => {
  // Egypt and Jordan both displace the employer-paid per-year gratuity through
  // their social insurance systems. Returning a computed accrual for these
  // employees would tell them they are owed money they are not owed, so the
  // calculator must refuse to produce a figure at all.
  const noGratuity = (['EG', 'JO'] as const).map((c) => GRATUITY_RULES[c]);

  it('flags both Egypt and Jordan as having no statutory gratuity', () => {
    for (const rule of noGratuity) {
      expect(rule.hasStatutoryGratuity, rule.country).toBe(false);
    }
  });

  it('returns no amount however long the service', () => {
    for (const rule of noGratuity) {
      const r = calculateGratuity(
        {
          monthlyWage: 20_000,
          hireDate: '1995-01-01',
          endDate: '2026-01-01',
          separationReason: 'termination',
        },
        rule,
      );
      expect(r.amount, rule.country).toBe(0);
      expect(r.notApplicable, rule.country).toBe(true);
      expect(r.bands, rule.country).toHaveLength(0);
    }
  });

  it('explains what applies instead, in both languages', () => {
    for (const rule of noGratuity) {
      const r = calculateGratuity(
        {
          monthlyWage: 20_000,
          hireDate: '2015-01-01',
          endDate: '2026-01-01',
          separationReason: 'resignation',
        },
        rule,
      );
      expect(r.alternativeProvision, rule.country).toBeDefined();
      expect(r.alternativeProvision!.en.length).toBeGreaterThan(40);
      expect(r.alternativeProvision!.ar).toMatch(/[؀-ۿ]/);
    }
  });

  it('says so in the breakdown rather than showing an empty calculation', () => {
    const r = calculateGratuity(
      {
        monthlyWage: 20_000,
        hireDate: '2015-01-01',
        endDate: '2026-01-01',
        separationReason: 'termination',
      },
      GRATUITY_RULES.EG,
    );
    expect(r.breakdown).toHaveLength(1);
    expect(r.breakdown[0]!.label.en).toMatch(/no statutory gratuity/i);
  });

  it('still computes normally for the countries that do have one', () => {
    for (const country of ['SA', 'AE'] as const) {
      const rule = GRATUITY_RULES[country];
      expect(rule.hasStatutoryGratuity, country).toBe(true);
      const r = calculateGratuity(
        {
          monthlyWage: 20_000,
          hireDate: '2015-01-01',
          endDate: '2026-01-01',
          separationReason: 'termination',
        },
        rule,
      );
      expect(r.notApplicable, country).toBe(false);
      expect(r.amount, country).toBeGreaterThan(0);
    }
  });

  it('keeps Egypt and Jordan source-verified, so no spurious warning is shown', () => {
    for (const rule of noGratuity) {
      expect(rule.verified, rule.country).toBe(true);
    }
  });
});
