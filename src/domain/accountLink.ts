/**
 * Linking a conversation to an employee record.
 *
 * WhatsApp identifies the sender by phone number, so the agent knows who it is
 * talking to. The web chat widget passes no identity at all, so a portal
 * visitor is anonymous and every personal request has to be refused.
 *
 * Claiming an employee id cannot be enough on its own — ids are guessable and
 * a colleague knows yours — so linking proves POSSESSION of a channel the HRIS
 * already holds for that employee: the code goes to the phone or email on the
 * record, not to one supplied in the conversation. Someone who does not
 * control that channel cannot complete the link no matter what they type.
 *
 * Pure and platform-free, so the expiry, attempt-budget and comparison rules
 * are unit-testable without a runtime.
 */

import { createHash, randomInt, timingSafeEqual } from 'node:crypto';

export interface PendingLink {
  /** The record being claimed. */
  employeeId: string;
  /** SHA-256 of the code. The code itself is never stored. */
  codeHash: string;
  /** ISO instant after which the code is dead. */
  expiresAt: string;
  /** Failed confirmations so far, against MAX_LINK_ATTEMPTS. */
  attempts: number;
}

/** Long enough to switch apps and read a message, short enough to be useless later. */
export const LINK_CODE_TTL_MINUTES = 10;

/** A six-digit code is 1-in-a-million per guess; three tries keeps it that way. */
export const MAX_LINK_ATTEMPTS = 3;

/**
 * Codes issued per hour, per conversation.
 *
 * Without this the attempt budget is decorative: every new request mints a
 * fresh code and resets the counter, so three guesses becomes unlimited
 * guesses for anyone willing to loop. It also stops the flow being used to
 * flood a colleague's phone with codes they did not ask for.
 */
export const MAX_LINK_REQUESTS = 3;
export const LINK_REQUEST_WINDOW_MINUTES = 60;

/** Codes issued so far in the current window. */
export interface RequestBudget {
  count: number;
  windowStartedAt: string;
}

export type LinkFailure = 'no_request' | 'expired' | 'too_many_attempts' | 'mismatch';

export type LinkVerdict = { ok: true; employeeId: string } | { ok: false; reason: LinkFailure };

/**
 * Stored instead of the code itself, so a leaked user record does not hand over
 * live codes. Six digits is a small space, so this is a speed bump rather than
 * a wall — the expiry and the attempt budget are what actually protect it — but
 * it keeps plaintext codes out of logs, dumps and support views.
 */
export function hashLinkCode(code: string): string {
  return createHash('sha256').update(code, 'utf8').digest('hex');
}

/** Whether another code may be issued now, and the budget to store afterwards. */
export function allowLinkRequest(
  budget: RequestBudget | null,
  nowIso: string,
): { allowed: boolean; next: RequestBudget } {
  const now = new Date(nowIso).getTime();
  const windowOpen =
    budget !== null &&
    now - new Date(budget.windowStartedAt).getTime() <= LINK_REQUEST_WINDOW_MINUTES * 60_000;

  if (!windowOpen) return { allowed: true, next: { count: 1, windowStartedAt: nowIso } };
  if (budget.count >= MAX_LINK_REQUESTS) return { allowed: false, next: budget };
  return { allowed: true, next: { count: budget.count + 1, windowStartedAt: budget.windowStartedAt } };
}

/**
 * Six digits, zero-padded — 000123 is a valid code and must not become "123".
 *
 * The source is a CSPRNG, not `Math.random`. V8 implements `Math.random` as
 * xorshift128+, whose internal state can be recovered from a modest number of
 * observed outputs — and this code is the only thing standing between someone
 * and a colleague's salary and end-of-service figures. Predicting the next code
 * would defeat the whole possession check.
 *
 * The parameter exists so the tests can pin exact values; production never
 * passes it.
 */
export function generateLinkCode(randomBelow: (max: number) => number = (max) => randomInt(max)): string {
  return String(randomBelow(1_000_000)).padStart(6, '0');
}

/**
 * Budget is checked before expiry so that exhausting the attempts closes the
 * request outright: a caller who has spent it learns nothing further about
 * whether the code was right, or even whether it was still alive.
 */
export function verifyLinkCode(
  pending: PendingLink | null,
  supplied: string,
  nowIso: string,
): LinkVerdict {
  if (!pending) return { ok: false, reason: 'no_request' };
  if (pending.attempts >= MAX_LINK_ATTEMPTS) return { ok: false, reason: 'too_many_attempts' };
  if (new Date(nowIso).getTime() > new Date(pending.expiresAt).getTime()) {
    return { ok: false, reason: 'expired' };
  }
  // People type codes back with a space in the middle.
  const supplied_ = hashLinkCode(supplied.replace(/\D/g, ''));
  // Compared as fixed-length digests so the comparison cannot leak how much of
  // the code was right through how long it took.
  const a = Buffer.from(supplied_, 'hex');
  const b = Buffer.from(pending.codeHash, 'hex');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: 'mismatch' };
  return { ok: true, employeeId: pending.employeeId };
}

/**
 * Enough of the destination to recognise your own phone or inbox, not enough
 * to tell a stranger where the code went.
 */
export function maskDestination(value: string): string {
  if (value.includes('@')) {
    const [local = '', domain = ''] = value.split('@');
    return `${local.slice(0, 1)}${'•'.repeat(Math.max(3, local.length - 1))}@${domain}`;
  }
  return `•••• ${value.replace(/\D/g, '').slice(-4)}`;
}
