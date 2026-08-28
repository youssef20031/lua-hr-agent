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
  LINK_CODE_TTL_MINUTES,
  MAX_LINK_ATTEMPTS,
  type PendingLink,
} from '../src/domain/accountLink.js';

const NOW = '2026-08-29T10:00:00.000Z';
const minutesFrom = (iso: string, m: number): string =>
  new Date(new Date(iso).getTime() + m * 60_000).toISOString();

const pending = (over: Partial<PendingLink> = {}): PendingLink => ({
  employeeId: 'E-1001',
  code: '123456',
  expiresAt: minutesFrom(NOW, LINK_CODE_TTL_MINUTES),
  attempts: 0,
  ...over,
});

describe('generateLinkCode', () => {
  it('is six digits', () => {
    expect(generateLinkCode(() => 0.5)).toMatch(/^\d{6}$/);
  });

  it('keeps leading zeros rather than shortening the code', () => {
    expect(generateLinkCode(() => 0)).toBe('000000');
  });

  it('uses the whole six-digit range', () => {
    expect(generateLinkCode(() => 0.9999999)).toBe('999999');
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
