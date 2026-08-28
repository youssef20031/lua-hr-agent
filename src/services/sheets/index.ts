/**
 * HR Ops sheet factory.
 *
 * One environment variable decides whether the agent talks to Google or to the
 * fixture store. Tools import `getOpsSheet()` and never learn which they got,
 * which is what lets a reviewer clone the repo and run the whole thing with no
 * credentials at all.
 *
 *   SHEETS_MODE=live      real Google Sheets (needs GOOGLE_SHEETS_ID + a key)
 *   SHEETS_MODE=fixture   local JSON store (default)
 *
 * `live` degrades to `fixture` rather than throwing at import time: an agent
 * that cannot reach a spreadsheet should still be able to answer leave
 * questions, and the degradation is reported through `health()`.
 */
import { FixtureOpsSheetClient, type FixtureOptions } from './fixture.js';
import { HttpOpsSheetClient } from './http.js';
import type { OpsSheetClient } from './types.js';

export * from './types.js';
export { FixtureOpsSheetClient } from './fixture.js';
export { HttpOpsSheetClient, SheetsApiError } from './http.js';
export { summarise } from './fixture.js';

export type SheetsMode = 'live' | 'fixture';

let cached: OpsSheetClient | null = null;
/** Populated when a requested live client could not be constructed. */
let degradedReason: string | null = null;

type EnvLike = Record<string, string | undefined>;

export function resolveSheetsMode(env: EnvLike = process.env): SheetsMode {
  return env.SHEETS_MODE?.toLowerCase() === 'live' ? 'live' : 'fixture';
}

export interface SheetsFactoryOptions {
  env?: EnvLike;
  /** Forces a mode, ignoring the environment. Used by tests. */
  mode?: SheetsMode;
  fixture?: FixtureOptions;
}

export function createOpsSheet(opts: SheetsFactoryOptions = {}): OpsSheetClient {
  const env = opts.env ?? process.env;
  const mode = opts.mode ?? resolveSheetsMode(env);

  if (mode === 'live') {
    try {
      const client = new HttpOpsSheetClient({ spreadsheetId: env.GOOGLE_SHEETS_ID ?? '' });
      degradedReason = null;
      return client;
    } catch (error) {
      // Misconfiguration should not take the agent down. Fall back loudly.
      degradedReason =
        error instanceof Error ? error.message : 'Unknown error building the live Sheets client.';
      // eslint-disable-next-line no-console
      console.warn(
        `[sheets] SHEETS_MODE=live requested but the live client could not be built, ` +
          `falling back to the fixture store. Reason: ${degradedReason}`,
      );
    }
  }

  return new FixtureOpsSheetClient(opts.fixture ?? {});
}

/** Process-wide singleton, so token and tab caches are shared. */
export function getOpsSheet(opts: SheetsFactoryOptions = {}): OpsSheetClient {
  cached ??= createOpsSheet(opts);
  return cached;
}

/** True when `live` was asked for but could not be provided. */
export function sheetsDegradedReason(): string | null {
  return degradedReason;
}

/** Test seam. */
export function resetOpsSheet(): void {
  cached = null;
  degradedReason = null;
}
