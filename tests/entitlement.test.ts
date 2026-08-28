import { describe, it, expect } from 'vitest';
import { calculateEntitlement, proRateEntitlement } from '../src/domain/entitlement.js';
import { LEAVE_RULES, leaveRuleFor, PROBATION_RULES, SICK_LEAVE_RULES } from '../src/domain/rules/leave.js';

const KSA_ANNUAL = leaveRuleFor('SA', 'annual')!;
const UAE_ANNUAL = leaveRuleFor('AE', 'annual')!;
const JO_ANNUAL = leaveRuleFor('JO', 'annual')!;

describe('KSA annual leave — Article 109', () => {
  it('gives 21 days in the first year', () => {
    const r = calculateEntitlement({ hireDate: '2025-01-01', asOf: '2026-01-15' }, KSA_ANNUAL);
    expect(r.days).toBe(21);
  });

  it('still gives 21 days at four years and eleven months', () => {
    const r = calculateEntitlement({ hireDate: '2021-03-01', asOf: '2026-02-01' }, KSA_ANNUAL);
    expect(r.days).toBe(21);
  });

  it('gives 30 days once five years are complete', () => {
    const r = calculateEntitlement({ hireDate: '2021-01-01', asOf: '2026-06-01' }, KSA_ANNUAL);
    expect(r.days).toBe(30);
  });

  it('gives 30 days to a long-serving employee', () => {
    const r = calculateEntitlement({ hireDate: '2005-01-01', asOf: '2026-01-01' }, KSA_ANNUAL);
    expect(r.days).toBe(30);
  });

  it('tells the employee when their entitlement steps up', () => {
    const r = calculateEntitlement({ hireDate: '2023-03-01', asOf: '2026-03-01' }, KSA_ANNUAL);
    expect(r.days).toBe(21);
    expect(r.nextStepUp).not.toBeNull();
    expect(r.nextStepUp!.date).toBe('2028-03-01');
    expect(r.nextStepUp!.days).toBe(30);
    expect(r.nextStepUp!.inDays).toBeGreaterThan(700);
  });

  it('reports no step-up once in the top band', () => {
    const r = calculateEntitlement({ hireDate: '2010-01-01', asOf: '2026-01-01' }, KSA_ANNUAL);
    expect(r.nextStepUp).toBeNull();
  });

  it('carries the Article 109 citation and is source-verified', () => {
    const r = calculateEntitlement({ hireDate: '2020-01-01', asOf: '2026-01-01' }, KSA_ANNUAL);
    expect(r.citation).toContain('Article 109');
    expect(r.verified).toBe(true);
    expect(r.warning).toBeUndefined();
  });

  it('handles a 29 February hire date without drifting', () => {
    const r = calculateEntitlement({ hireDate: '2024-02-29', asOf: '2026-03-01' }, KSA_ANNUAL);
    expect(r.days).toBe(21);
    // Five years from 29 Feb 2024 clamps to 28 Feb 2029.
    expect(r.nextStepUp!.date).toBe('2029-02-28');
  });
});

describe('countries with a qualifying period', () => {
  it('reports UAE staff below one year as not yet qualified', () => {
    const r = calculateEntitlement({ hireDate: '2026-01-01', asOf: '2026-06-01' }, UAE_ANNUAL);
    expect(r.notYetQualified).toBe(true);
    expect(r.days).toBe(0);
    expect(r.nextStepUp).not.toBeNull();
    expect(r.nextStepUp!.date).toBe('2027-01-01');
  });

  it('gives UAE staff 30 days once past one year', () => {
    const r = calculateEntitlement({ hireDate: '2024-01-01', asOf: '2026-01-01' }, UAE_ANNUAL);
    expect(r.days).toBe(30);
    expect(r.notYetQualified).toBe(false);
  });

  it('gives Egyptian staff 15 days in year one, not 21', () => {
    // Law 14/2025 lowered the first-year tier; guidance still saying 21 after
    // one year is quoting the repealed Law 12/2003.
    const rule = leaveRuleFor('EG', 'annual')!;
    expect(calculateEntitlement({ hireDate: '2026-03-01', asOf: '2026-09-01' }, rule).days).toBe(15);
    expect(calculateEntitlement({ hireDate: '2024-01-01', asOf: '2026-01-01' }, rule).days).toBe(21);
    expect(calculateEntitlement({ hireDate: '2010-01-01', asOf: '2026-01-01' }, rule).days).toBe(30);
  });

  it('counts Egyptian and Jordanian leave in working days', () => {
    // Both statutes exclude official holidays and weekly rest from the count.
    expect(leaveRuleFor('EG', 'annual')!.dayBasis).toBe('working');
    expect(leaveRuleFor('JO', 'annual')!.dayBasis).toBe('working');
  });

  it('steps Jordan staff from 14 to 21 days at five years', () => {
    const early = calculateEntitlement({ hireDate: '2023-01-01', asOf: '2026-01-01' }, JO_ANNUAL);
    const later = calculateEntitlement({ hireDate: '2018-01-01', asOf: '2026-01-01' }, JO_ANNUAL);
    expect(early.days).toBe(14);
    expect(later.days).toBe(21);
  });
});

describe('provenance', () => {
  it('warns on a result derived from an unverified rule', () => {
    // Synthetic, so this keeps testing the mechanism as real rules get verified.
    const r = calculateEntitlement(
      { hireDate: '2015-01-01', asOf: '2026-01-01' },
      { ...KSA_ANNUAL, verified: false, citation: 'Synthetic (UNVERIFIED)' },
    );
    expect(r.verified).toBe(false);
    expect(r.warning).toBeDefined();
    expect(r.warning!.ar).toMatch(/[؀-ۿ]/);
  });

  it('attaches no warning to a verified rule', () => {
    for (const rule of [KSA_ANNUAL, UAE_ANNUAL, JO_ANNUAL]) {
      const r = calculateEntitlement({ hireDate: '2015-01-01', asOf: '2026-01-01' }, rule);
      expect(r.verified, rule.country).toBe(true);
      expect(r.warning, rule.country).toBeUndefined();
    }
  });

  it('has every annual-leave rule source-verified across all four countries', () => {
    for (const country of ['SA', 'AE', 'EG', 'JO'] as const) {
      expect(leaveRuleFor(country, 'annual')!.verified, country).toBe(true);
    }
  });

  it('labels every unverified leave, sick and probation row in its citation', () => {
    const allRows = [
      ...Object.values(LEAVE_RULES).flatMap((byType) => Object.values(byType)),
      ...Object.values(SICK_LEAVE_RULES),
      ...Object.values(PROBATION_RULES),
    ];
    for (const row of allRows) {
      if (row.verified) continue;
      const marked =
        row.citation.toUpperCase().includes('UNVERIFIED') ||
        row.citation.toLowerCase().includes('company policy');
      expect(marked, `${row.country} / ${row.citation}`).toBe(true);
    }
  });

  it('gives every row a source URL and review date', () => {
    const allRows = [
      ...Object.values(LEAVE_RULES).flatMap((byType) => Object.values(byType)),
      ...Object.values(SICK_LEAVE_RULES),
      ...Object.values(PROBATION_RULES),
    ];
    for (const row of allRows) {
      expect(row.sourceUrl).toMatch(/^https?:\/\//);
      expect(row.lastReviewed).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});

describe('sick leave and probation tables', () => {
  it('has contiguous sick-leave tiers starting at day one', () => {
    for (const rule of Object.values(SICK_LEAVE_RULES)) {
      expect(rule.tiers[0]!.fromDay, rule.country).toBe(1);
      for (let i = 1; i < rule.tiers.length; i++) {
        expect(rule.tiers[i]!.fromDay, rule.country).toBe((rule.tiers[i - 1]!.toDay ?? 0) + 1);
      }
    }
  });

  it('keeps sick-leave pay rates between zero and one', () => {
    for (const rule of Object.values(SICK_LEAVE_RULES)) {
      for (const tier of rule.tiers) {
        expect(tier.payRate).toBeGreaterThanOrEqual(0);
        expect(tier.payRate).toBeLessThanOrEqual(1);
      }
    }
  });

  it('never allows an extension shorter than the base probation', () => {
    for (const rule of Object.values(PROBATION_RULES)) {
      expect(rule.maxDaysWithExtension, rule.country).toBeGreaterThanOrEqual(rule.maxDays);
    }
  });
});

describe('proRateEntitlement', () => {
  it('halves entitlement for half a year', () => {
    expect(proRateEntitlement(30, 182)).toBeCloseTo(15, 0);
  });

  it('returns the full entitlement for a whole year', () => {
    expect(proRateEntitlement(21, 365)).toBe(21);
  });

  it('does not exceed the full entitlement past a year', () => {
    expect(proRateEntitlement(21, 400)).toBe(21);
  });

  it('returns zero for no service', () => {
    expect(proRateEntitlement(30, 0)).toBe(0);
  });

  it('rejects a negative period', () => {
    expect(() => proRateEntitlement(30, -5)).toThrow(/negative/);
  });
});

describe('input validation', () => {
  it('rejects an as-of date before the hire date', () => {
    expect(() =>
      calculateEntitlement({ hireDate: '2026-01-01', asOf: '2025-01-01' }, KSA_ANNUAL),
    ).toThrow(/precedes hire date/);
  });
});
