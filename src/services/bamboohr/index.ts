/**
 * HRIS factory.
 *
 * One environment variable picks the backend:
 *
 *   HRIS_MODE=live      real BambooHR (needs BAMBOOHR_COMPANY_DOMAIN + BAMBOOHR_API_KEY)
 *   HRIS_MODE=fixture   in-memory HRIS (default)
 *
 * As with the Sheets factory, a misconfigured `live` degrades to `fixture`
 * rather than throwing at import time. An HR agent that cannot reach BambooHR
 * should still answer policy questions and calculate gratuity, and the
 * degradation is visible through `health()` rather than hidden.
 */
import { FixtureHrisClient, type FixtureHrisOptions } from './fixture.js';
import { HttpHrisClient } from './http.js';
import type { HrisClient } from './types.js';

export * from './types.js';
export { FixtureHrisClient } from './fixture.js';
export { HttpHrisClient } from './http.js';
export { TIME_OFF_TYPES } from './fixture.js';

export type HrisMode = 'live' | 'fixture';

type EnvLike = Record<string, string | undefined>;

let cached: HrisClient | null = null;
let degradedReason: string | null = null;

export function resolveHrisMode(env: EnvLike = process.env): HrisMode {
  return env.HRIS_MODE?.toLowerCase() === 'live' ? 'live' : 'fixture';
}

export interface HrisFactoryOptions {
  env?: EnvLike;
  mode?: HrisMode;
  fixture?: FixtureHrisOptions;
}

export function createHris(opts: HrisFactoryOptions = {}): HrisClient {
  const env = opts.env ?? process.env;
  const mode = opts.mode ?? resolveHrisMode(env);

  if (mode === 'live') {
    try {
      const client = new HttpHrisClient({
        companyDomain: env.BAMBOOHR_COMPANY_DOMAIN ?? '',
        apiKey: env.BAMBOOHR_API_KEY ?? '',
        ...(env.BAMBOOHR_BASE_URL ? { baseUrl: env.BAMBOOHR_BASE_URL } : {}),
        ...(env.BAMBOOHR_PERMIT_FIELD ? { permitExpiryField: env.BAMBOOHR_PERMIT_FIELD } : {}),
      });
      degradedReason = null;
      return client;
    } catch (error) {
      degradedReason =
        error instanceof Error ? error.message : 'Unknown error building the live HRIS client.';
      // eslint-disable-next-line no-console
      console.warn(
        `[hris] HRIS_MODE=live requested but the live client could not be built, ` +
          `falling back to the fixture HRIS. Reason: ${degradedReason}`,
      );
    }
  }

  return new FixtureHrisClient(opts.fixture ?? {});
}

/** Process-wide singleton so directory reads are not repeated needlessly. */
export function getHris(opts: HrisFactoryOptions = {}): HrisClient {
  cached ??= createHris(opts);
  return cached;
}

export function hrisDegradedReason(): string | null {
  return degradedReason;
}

/** Test seam. */
export function resetHris(): void {
  cached = null;
  degradedReason = null;
}
