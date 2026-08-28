import { describe, it, expect } from 'vitest';
import {
  ALERT_DAYS,
  checkIqamaExpiry,
  dueForAlert,
  severityFor,
  sortByUrgency,
  withinHorizon,
} from '../src/domain/iqama.js';

const AS_OF = '2026-08-28';

function status(expiryDate: string, employeeId = 'E-001') {
  return checkIqamaExpiry({ employeeId, expiryDate, asOf: AS_OF });
}

describe('severityFor', () => {
  it('bands each threshold correctly', () => {
    expect(severityFor(365)).toBe('ok');
    expect(severityFor(91)).toBe('ok');
    expect(severityFor(90)).toBe('notice');
    expect(severityFor(61)).toBe('notice');
    expect(severityFor(60)).toBe('warning');
    expect(severityFor(31)).toBe('warning');
    expect(severityFor(30)).toBe('urgent');
    expect(severityFor(8)).toBe('urgent');
    expect(severityFor(7)).toBe('critical');
    expect(severityFor(1)).toBe('critical');
    expect(severityFor(0)).toBe('critical');
    expect(severityFor(-1)).toBe('expired');
    expect(severityFor(-400)).toBe('expired');
  });

  it('treats the day of expiry as critical, not expired', () => {
    // The permit is still valid on its expiry date.
    expect(severityFor(0)).toBe('critical');
  });
});

describe('checkIqamaExpiry', () => {
  it('counts days remaining correctly', () => {
    expect(status('2026-09-27').daysRemaining).toBe(30);
    expect(status('2026-08-28').daysRemaining).toBe(0);
    expect(status('2026-08-18').daysRemaining).toBe(-10);
  });

  it('requires no action when comfortably valid', () => {
    const s = status('2027-06-01');
    expect(s.severity).toBe('ok');
    expect(s.actionRequired).toBe(false);
  });

  it('requires action inside the 90-day window', () => {
    const s = status('2026-11-26'); // 90 days out
    expect(s.severity).toBe('notice');
    expect(s.actionRequired).toBe(true);
  });

  it('flags an expired permit and says how long ago', () => {
    const s = status('2026-08-01');
    expect(s.severity).toBe('expired');
    expect(s.message.en).toContain('27 days ago');
    expect(s.message.en).toContain('do not travel');
  });

  it('fires only on the exact alert days so the daily sweep does not spam', () => {
    expect(status('2026-11-26').isAlertDay).toBe(true); // 90
    expect(status('2026-10-27').isAlertDay).toBe(true); // 60
    expect(status('2026-09-27').isAlertDay).toBe(true); // 30
    expect(status('2026-09-04').isAlertDay).toBe(true); // 7
    expect(status('2026-09-28').isAlertDay).toBe(false); // 31
    expect(status('2026-09-03').isAlertDay).toBe(false); // 6
  });

  it('keeps ALERT_DAYS and the threshold bands consistent', () => {
    for (const days of ALERT_DAYS) {
      expect(severityFor(days)).not.toBe('ok');
    }
  });

  it('produces a message in both languages at every severity', () => {
    const dates = ['2027-06-01', '2026-11-26', '2026-10-27', '2026-09-27', '2026-09-04', '2026-08-01'];
    for (const d of dates) {
      const s = status(d);
      expect(s.message.en.length).toBeGreaterThan(10);
      expect(s.message.ar.length).toBeGreaterThan(10);
      expect(s.message.ar, `Arabic missing for ${d}`).toMatch(/[؀-ۿ]/);
    }
  });

  it('escalates the wording as the deadline approaches', () => {
    expect(status('2026-11-26').message.en).toContain('renewal window is open');
    expect(status('2026-09-27').message.en).toContain('line manager');
    expect(status('2026-09-04').message.en).toContain('urgent');
  });

  it('uses the Emirates ID label for UAE staff', () => {
    const s = checkIqamaExpiry({
      employeeId: 'E-500',
      expiryDate: '2026-09-27',
      asOf: AS_OF,
      documentType: 'emirates_id',
    });
    expect(s.documentLabel.en).toBe('Emirates ID');
    expect(s.message.en).toContain('Emirates ID');
    expect(s.message.ar).toContain('الهوية الإماراتية');
  });

  it('defaults to the Iqama label', () => {
    expect(status('2026-09-27').documentLabel.en).toBe('Iqama');
    expect(status('2026-09-27').message.ar).toContain('الإقامة');
  });

  it('echoes back a normalised expiry date', () => {
    expect(status('2026-09-27').expiryDate).toBe('2026-09-27');
  });

  it('rejects a malformed expiry date', () => {
    expect(() => status('27/09/2026')).toThrow(/Expected ISO format/);
  });
});

describe('sortByUrgency', () => {
  it('puts the most urgent first, expired ahead of everything', () => {
    const list = [status('2027-01-01', 'A'), status('2026-08-01', 'B'), status('2026-09-04', 'C')];
    const sorted = sortByUrgency(list);
    expect(sorted.map((s) => s.employeeId)).toEqual(['B', 'C', 'A']);
  });

  it('does not mutate the input array', () => {
    const list = [status('2027-01-01', 'A'), status('2026-08-01', 'B')];
    const before = list.map((s) => s.employeeId);
    sortByUrgency(list);
    expect(list.map((s) => s.employeeId)).toEqual(before);
  });
});

describe('dueForAlert', () => {
  it('selects only threshold days plus anything already expired', () => {
    const list = [
      status('2026-11-26', 'ALERT-90'),
      status('2026-11-27', 'QUIET-91'),
      status('2026-09-27', 'ALERT-30'),
      status('2026-09-28', 'QUIET-31'),
      status('2026-08-01', 'EXPIRED'),
      status('2028-01-01', 'FINE'),
    ];
    const due = dueForAlert(list);
    expect(due.map((s) => s.employeeId)).toEqual(['EXPIRED', 'ALERT-30', 'ALERT-90']);
  });

  it('returns an empty list when nobody needs alerting', () => {
    expect(dueForAlert([status('2028-01-01'), status('2027-12-01')])).toEqual([]);
  });
});

describe('withinHorizon', () => {
  const asOf = { year: 2026, month: 8, day: 28 };

  it('includes anything inside the horizon', () => {
    expect(withinHorizon('2026-11-26', 90, asOf)).toBe(true);
    expect(withinHorizon('2026-09-01', 90, asOf)).toBe(true);
  });

  it('excludes anything beyond it', () => {
    expect(withinHorizon('2026-11-27', 90, asOf)).toBe(false);
    expect(withinHorizon('2028-01-01', 90, asOf)).toBe(false);
  });

  it('always includes an already-expired permit regardless of horizon', () => {
    expect(withinHorizon('2020-01-01', 90, asOf)).toBe(true);
  });

  it('respects a custom horizon', () => {
    expect(withinHorizon('2026-10-01', 30, asOf)).toBe(false);
    expect(withinHorizon('2026-10-01', 60, asOf)).toBe(true);
  });
});
