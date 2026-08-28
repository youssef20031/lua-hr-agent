import { describe, it, expect } from 'vitest';
import {
  parseDate,
  formatDate,
  daysBetween,
  inclusiveDays,
  addDays,
  serviceDuration,
  serviceDurationFromStrings,
  daysInMonth,
  isLeapYear,
  today,
} from '../src/domain/date.js';

describe('parseDate', () => {
  it('parses a valid ISO date', () => {
    expect(parseDate('2024-03-15')).toEqual({ year: 2024, month: 3, day: 15 });
  });

  it('accepts 29 February in a leap year', () => {
    expect(parseDate('2024-02-29').day).toBe(29);
  });

  it('rejects 29 February in a non-leap year', () => {
    expect(() => parseDate('2023-02-29')).toThrow(/out of range/);
  });

  it('rejects a malformed string', () => {
    expect(() => parseDate('15/03/2024')).toThrow(/Expected ISO format/);
  });

  it('rejects month 13', () => {
    expect(() => parseDate('2024-13-01')).toThrow(/month 13/);
  });

  it('round-trips through formatDate with zero padding', () => {
    expect(formatDate(parseDate('2024-01-05'))).toBe('2024-01-05');
  });
});

describe('calendar helpers', () => {
  it('knows month lengths', () => {
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2023, 2)).toBe(28);
    expect(daysInMonth(2024, 4)).toBe(30);
    expect(daysInMonth(2024, 12)).toBe(31);
  });

  it('applies the century rule for leap years', () => {
    expect(isLeapYear(2000)).toBe(true);
    expect(isLeapYear(1900)).toBe(false);
    expect(isLeapYear(2024)).toBe(true);
  });
});

describe('daysBetween / inclusiveDays', () => {
  it('counts consecutive days as one apart', () => {
    expect(daysBetween(parseDate('2024-01-01'), parseDate('2024-01-02'))).toBe(1);
  });

  it('counts a leave request from the 10th to the 15th as six days', () => {
    expect(inclusiveDays(parseDate('2026-03-10'), parseDate('2026-03-15'))).toBe(6);
  });

  it('counts a single-day request as one day', () => {
    expect(inclusiveDays(parseDate('2026-03-10'), parseDate('2026-03-10'))).toBe(1);
  });

  it('crosses a leap day correctly', () => {
    expect(daysBetween(parseDate('2024-02-28'), parseDate('2024-03-01'))).toBe(2);
    expect(daysBetween(parseDate('2023-02-28'), parseDate('2023-03-01'))).toBe(1);
  });

  it('is not perturbed by a local timezone offset', () => {
    // Both endpoints are civil dates; the result must be exact regardless of TZ.
    expect(daysBetween(parseDate('2020-01-01'), parseDate('2021-01-01'))).toBe(366);
    expect(daysBetween(parseDate('2021-01-01'), parseDate('2022-01-01'))).toBe(365);
  });
});

describe('addDays', () => {
  it('rolls over a month boundary', () => {
    expect(formatDate(addDays(parseDate('2024-01-31'), 1))).toBe('2024-02-01');
  });

  it('rolls over a year boundary', () => {
    expect(formatDate(addDays(parseDate('2024-12-31'), 1))).toBe('2025-01-01');
  });

  it('goes backwards with a negative offset', () => {
    expect(formatDate(addDays(parseDate('2024-03-01'), -1))).toBe('2024-02-29');
  });
});

describe('serviceDuration', () => {
  it('computes an exact whole year', () => {
    const d = serviceDurationFromStrings('2020-01-01', '2021-01-01');
    expect(d.years).toBe(1);
    expect(d.months).toBe(0);
    expect(d.days).toBe(0);
    expect(d.totalDays).toBe(366);
  });

  it('computes years, months and days for a ragged period', () => {
    const d = serviceDurationFromStrings('2018-03-01', '2026-08-15');
    expect(d.years).toBe(8);
    expect(d.months).toBe(5);
    expect(d.days).toBe(14);
  });

  it('borrows correctly when the end day precedes the hire day', () => {
    const d = serviceDurationFromStrings('2020-01-31', '2020-03-01');
    expect(d.years).toBe(0);
    expect(d.months).toBe(1);
    // 31 Jan -> 29 Feb is one month; 29 Feb -> 1 Mar is one more day.
    expect(d.days).toBe(1);
  });

  it('borrows across a January end date', () => {
    const d = serviceDurationFromStrings('2019-12-15', '2020-01-10');
    expect(d.years).toBe(0);
    expect(d.months).toBe(0);
    expect(d.days).toBe(26);
  });

  it('reports zero for same-day start and end', () => {
    const d = serviceDurationFromStrings('2024-05-05', '2024-05-05');
    expect(d.totalDays).toBe(0);
    expect(d.decimalYears).toBe(0);
  });

  it('expresses service as decimal years on a 365-day basis', () => {
    const d = serviceDurationFromStrings('2021-01-01', '2022-01-01');
    expect(d.decimalYears).toBeCloseTo(1, 10);
  });

  it('refuses an end date before the hire date', () => {
    expect(() => serviceDurationFromStrings('2024-01-01', '2023-01-01')).toThrow(/precedes hire date/);
  });
});

describe('today', () => {
  it('returns the Riyadh calendar date for a known instant', () => {
    // 2026-03-10T22:30:00Z is already 2026-03-11 in Riyadh (UTC+3).
    const d = today('Asia/Riyadh', new Date('2026-03-10T22:30:00Z'));
    expect(formatDate(d)).toBe('2026-03-11');
  });

  it('differs from UTC across the offset boundary', () => {
    const riyadh = today('Asia/Riyadh', new Date('2026-03-10T22:30:00Z'));
    const utc = today('UTC', new Date('2026-03-10T22:30:00Z'));
    expect(formatDate(riyadh)).toBe('2026-03-11');
    expect(formatDate(utc)).toBe('2026-03-10');
  });
});
