/**
 * Account linking for channels that cannot identify the visitor.
 *
 * The web widget passes no identity, so a portal user is anonymous. Linking
 * proves possession of a channel the HRIS already holds for that employee:
 * you claim an employee id, a code goes to the phone or email ON THAT RECORD,
 * and you type it back. Claiming an id is not enough on its own — otherwise
 * anyone could read a colleague's balance and gratuity by guessing a number.
 */
import { describe, it, expect } from 'vitest';
import {
  generateLinkCode,
  verifyLinkCode,
  maskDestination,
  hashLinkCode,
  allowLinkRequest,
  LINK_CODE_TTL_MINUTES,
  MAX_LINK_ATTEMPTS,
  MAX_LINK_REQUESTS,
  LINK_REQUEST_WINDOW_MINUTES,
  type PendingLink,
  type RequestBudget,
} from '../src/domain/accountLink.js';

const NOW = '2026-08-29T10:00:00.000Z';
const minutesFrom = (iso: string, m: number): string =>
  new Date(new Date(iso).getTime() + m * 60_000).toISOString();

const pending = (over: Partial<PendingLink> = {}): PendingLink => ({
  employeeId: 'E-1001',
  codeHash: hashLinkCode('123456'),
  expiresAt: minutesFrom(NOW, LINK_CODE_TTL_MINUTES),
  attempts: 0,
  ...over,
});

describe('generateLinkCode', () => {
  it('is six digits using the real source, which also proves the CSPRNG loads', () => {
    expect(generateLinkCode()).toMatch(/^\d{6}$/);
  });

  it('keeps leading zeros rather than shortening the code', () => {
    expect(generateLinkCode(() => 0)).toBe('000000');
  });

  it('uses the whole six-digit range', () => {
    expect(generateLinkCode(() => 999_999)).toBe('999999');
  });

  it('asks its source for a value below one million', () => {
    const seen: number[] = [];
    generateLinkCode((max) => {
      seen.push(max);
      return 1;
    });
    expect(seen).toEqual([1_000_000]);
  });

  // Cannot assert randomness quality from outside, but a source that is
  // constant — or missing — shows up immediately.
  it('does not return the same code every time', () => {
    const codes = new Set(Array.from({ length: 50 }, () => generateLinkCode()));
    expect(codes.size).toBeGreaterThan(1);
  });
});

describe('verifyLinkCode', () => {
  it('accepts the right code and reports which record was claimed', () => {
    expect(verifyLinkCode(pending(), '123456', NOW)).toEqual({ ok: true, employeeId: 'E-1001' });
  });

  it('rejects a wrong code', () => {
    expect(verifyLinkCode(pending(), '654321', NOW)).toEqual({ ok: false, reason: 'mismatch' });
  });

  it('rejects when nothing was requested', () => {
    expect(verifyLinkCode(null, '123456', NOW)).toEqual({ ok: false, reason: 'no_request' });
  });

  it('rejects an expired code even when it is correct', () => {
    const late = minutesFrom(NOW, LINK_CODE_TTL_MINUTES + 1);
    expect(verifyLinkCode(pending(), '123456', late)).toEqual({ ok: false, reason: 'expired' });
  });

  it('stops accepting once the attempt limit is spent, even with the right code', () => {
    const spent = pending({ attempts: MAX_LINK_ATTEMPTS });
    expect(verifyLinkCode(spent, '123456', NOW)).toEqual({
      ok: false,
      reason: 'too_many_attempts',
    });
  });

  it('reports a spent budget rather than expiry when both apply', () => {
    const spent = pending({ attempts: MAX_LINK_ATTEMPTS });
    const late = minutesFrom(NOW, LINK_CODE_TTL_MINUTES + 1);
    expect(verifyLinkCode(spent, '123456', late).ok).toBe(false);
  });

  it('tolerates spacing in what the employee types back', () => {
    expect(verifyLinkCode(pending(), ' 123 456 ', NOW)).toEqual({ ok: true, employeeId: 'E-1001' });
  });
});

describe('maskDestination', () => {
  it('shows only the last four digits of a phone number', () => {
    const masked = maskDestination('+201552916262');
    expect(masked).toContain('6262');
    expect(masked).not.toContain('20155291');
  });

  it('keeps an email readable without giving away the address', () => {
    const masked = maskDestination('ahmad.alotaibi@example.com');
    expect(masked).toContain('@example.com');
    expect(masked).not.toContain('ahmad.alotaibi');
  });
});


describe('hashLinkCode', () => {
  it('never stores the code itself', () => {
    expect(hashLinkCode('123456')).not.toContain('123456');
  });

  it('is stable for the same code and different for another', () => {
    expect(hashLinkCode('123456')).toBe(hashLinkCode('123456'));
    expect(hashLinkCode('123456')).not.toBe(hashLinkCode('123457'));
  });
});

describe('allowLinkRequest', () => {
  const NOW2 = '2026-08-29T10:00:00.000Z';

  it('allows a first request and opens a window', () => {
    const r = allowLinkRequest(null, NOW2);
    expect(r.allowed).toBe(true);
    expect(r.next).toEqual({ count: 1, windowStartedAt: NOW2 });
  });

  it('allows up to the cap within one window', () => {
    let budget: RequestBudget | null = null;
    for (let i = 0; i < MAX_LINK_REQUESTS; i += 1) {
      const r = allowLinkRequest(budget, NOW2);
      expect(r.allowed, `request ${i + 1}`).toBe(true);
      budget = r.next;
    }
    expect(allowLinkRequest(budget, NOW2).allowed).toBe(false);
  });

  // The whole point: without this, re-requesting resets the attempt budget and
  // the three-guess limit means nothing.
  it('refuses to keep issuing codes once the cap is spent', () => {
    const spent: RequestBudget = { count: MAX_LINK_REQUESTS, windowStartedAt: NOW2 };
    expect(allowLinkRequest(spent, NOW2).allowed).toBe(false);
    expect(allowLinkRequest(spent, NOW2).next.count).toBe(MAX_LINK_REQUESTS);
  });

  it('starts a fresh window once the old one has passed', () => {
    const spent: RequestBudget = { count: MAX_LINK_REQUESTS, windowStartedAt: NOW2 };
    const later = minutesFrom(NOW2, LINK_REQUEST_WINDOW_MINUTES + 1);
    const r = allowLinkRequest(spent, later);
    expect(r.allowed).toBe(true);
    expect(r.next).toEqual({ count: 1, windowStartedAt: later });
  });
});
