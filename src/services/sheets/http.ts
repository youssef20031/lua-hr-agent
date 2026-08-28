/**
 * Live Google Sheets implementation of the HR Ops sheet.
 *
 * Notes that cost real debugging time if missed:
 *
 *  - `values` is ABSENT from a read response for an empty range, not `[]`, and
 *    rows are truncated at the last non-empty cell. Everything is normalised on
 *    the way in.
 *  - The append range is a SEARCH range, not a destination. Google finds the
 *    contiguous table within it and appends after the last row, so a whole-column
 *    range is passed rather than a single cell.
 *  - `valueInputOption` is RAW throughout. USER_ENTERED would turn an employee
 *    code like "01234" into 1234 and a phone number like "+9665..." into a
 *    number, and would treat a value starting with "=" as a formula.
 *  - A 403 here almost always means the spreadsheet has not been shared with the
 *    service account, so that is what the error message says.
 */
import {
  getAccessToken,
  invalidateAccessToken,
  loadServiceAccount,
  SCOPE_SHEETS_RW,
  type ServiceAccountKey,
} from './googleAuth.js';
import { summarise } from './fixture.js';
import {
  HEADERS,
  TABS,
  iqamaWatchToValues,
  leaveAuditToValues,
  sopGapToValues,
  type AppendOutcome,
  type IqamaWatchRow,
  type LeaveAuditRow,
  type OpsSheetClient,
  type OpsSummary,
  type SheetsHealth,
  type SopGapRow,
  type TabName,
} from './types.js';
import type { CountryCode, Language } from '../../domain/types.js';
import type { IqamaSeverity } from '../../domain/iqama.js';

const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

export class SheetsApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly googleStatus: string | undefined,
    readonly body: string,
  ) {
    super(message);
    this.name = 'SheetsApiError';
  }
  get isAuth(): boolean {
    return this.status === 401;
  }
  get isForbidden(): boolean {
    return this.status === 403;
  }
  get isRetryable(): boolean {
    return this.status === 429 || this.status >= 500;
  }
}

/** Quotes a tab title for A1 notation, doubling any embedded apostrophe. */
export function quoteSheetName(title: string): string {
  return `'${title.replace(/'/g, "''")}'`;
}

export function a1(title: string, cells?: string): string {
  return cells ? `${quoteSheetName(title)}!${cells}` : quoteSheetName(title);
}

/** 1 -> "A", 26 -> "Z", 27 -> "AA" */
export function colLetter(n: number): string {
  let s = '';
  let remaining = n;
  while (remaining > 0) {
    const r = (remaining - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    remaining = Math.floor((remaining - 1) / 26);
  }
  return s;
}

export interface HttpSheetsOptions {
  spreadsheetId: string;
  key?: ServiceAccountKey;
  maxRetries?: number;
  now?: () => Date;
}

export class HttpOpsSheetClient implements OpsSheetClient {
  readonly mode = 'live' as const;

  private readonly spreadsheetId: string;
  private readonly key: ServiceAccountKey;
  private readonly maxRetries: number;
  private readonly now: () => Date;
  private tabsEnsured = false;

  constructor(opts: HttpSheetsOptions) {
    if (!opts.spreadsheetId) {
      throw new Error(
        'GOOGLE_SHEETS_ID is required for the live Sheets client. It is the segment ' +
          'between /d/ and /edit in the spreadsheet URL, not the whole URL.',
      );
    }
    this.spreadsheetId = opts.spreadsheetId;
    this.key = opts.key ?? loadServiceAccount();
    this.maxRetries = opts.maxRetries ?? 4;
    this.now = opts.now ?? (() => new Date());
  }

  private async request<T>(init: {
    method: 'GET' | 'POST' | 'PUT';
    path: string;
    query?: Array<[string, string]>;
    body?: unknown;
  }): Promise<T> {
    const qs = init.query?.length ? `?${new URLSearchParams(init.query).toString()}` : '';
    const url = `${SHEETS_BASE}${init.path}${qs}`;

    let attempt = 0;
    let refreshed = false;

    for (;;) {
      const token = await getAccessToken({ key: this.key, scope: SCOPE_SHEETS_RW });
      const res = await fetch(url, {
        method: init.method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          ...(init.body !== undefined
            ? { 'Content-Type': 'application/json; charset=utf-8' }
            : {}),
        },
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      });

      if (res.ok) return (await res.json()) as T;

      const text = await res.text();
      const err = this.decodeError(res.status, res.statusText, text);

      // One reactive refresh covers a rotated key or a clock jump.
      if (err.isAuth && !refreshed) {
        refreshed = true;
        invalidateAccessToken(this.key.client_email, SCOPE_SHEETS_RW);
        continue;
      }

      if (err.isRetryable && attempt < this.maxRetries) {
        const retryAfter = Number(res.headers.get('retry-after'));
        const backoff =
          Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : Math.min(2 ** attempt * 1000, 16_000) + Math.floor(Math.random() * 1000);
        attempt += 1;
        await new Promise((r) => setTimeout(r, backoff));
        continue;
      }

      throw err;
    }
  }

  private decodeError(status: number, statusText: string, body: string): SheetsApiError {
    let message = body.slice(0, 400);
    let googleStatus: string | undefined;
    try {
      const parsed = JSON.parse(body) as { error?: { message?: string; status?: string } };
      if (parsed.error) {
        message = parsed.error.message ?? message;
        googleStatus = parsed.error.status;
      }
    } catch {
      // Non-JSON error body, e.g. an HTML page from a proxy.
    }

    // The overwhelmingly common cause of a 403 here is a sharing mistake, so say so.
    if (status === 403 && !/quota|rate limit/i.test(message)) {
      message =
        `${message} — the spreadsheet is most likely not shared with ` +
        `${this.key.client_email}. Open the sheet, choose Share, add that address ` +
        `as an Editor, and untick "Notify people".`;
    }
    if (status === 404) {
      message = `${message} — check GOOGLE_SHEETS_ID is the /d/<ID>/ segment of the URL, not the whole URL.`;
    }

    return new SheetsApiError(
      `Sheets API ${status} ${googleStatus ?? statusText}: ${message}`,
      status,
      googleStatus,
      body,
    );
  }

  private async listTabs(): Promise<Array<{ sheetId: number; title: string }>> {
    const json = await this.request<{
      sheets?: Array<{ properties: { sheetId: number; title: string } }>;
    }>({
      method: 'GET',
      path: `/${encodeURIComponent(this.spreadsheetId)}`,
      query: [['fields', 'sheets.properties(sheetId,title)']],
    });
    return (json.sheets ?? []).map((s) => s.properties);
  }

  async ensureTabs(): Promise<void> {
    const existing = await this.listTabs();
    const have = new Set(existing.map((t) => t.title));

    for (const title of Object.values(TABS) as TabName[]) {
      if (have.has(title)) continue;
      const header = HEADERS[title];

      await this.request({
        method: 'POST',
        path: `/${encodeURIComponent(this.spreadsheetId)}:batchUpdate`,
        body: {
          requests: [
            {
              addSheet: {
                properties: {
                  title,
                  gridProperties: {
                    rowCount: 2000,
                    columnCount: Math.max(header.length, 12),
                    frozenRowCount: 1,
                  },
                },
              },
            },
          ],
        },
      });

      // addSheet cannot write values, so the header goes in as a separate update.
      const range = a1(title, `A1:${colLetter(header.length)}1`);
      await this.request({
        method: 'PUT',
        path: `/${encodeURIComponent(this.spreadsheetId)}/values/${encodeURIComponent(range)}`,
        query: [['valueInputOption', 'RAW']],
        body: { range, majorDimension: 'ROWS', values: [header] },
      });
    }
    this.tabsEnsured = true;
  }

  private async append(tab: TabName, values: (string | number)[]): Promise<AppendOutcome> {
    if (!this.tabsEnsured) await this.ensureTabs();

    // A whole-column search range: a single cell would let a blank row split the
    // table and land the append in the middle of the sheet.
    const range = a1(tab, 'A:ZZ');
    const json = await this.request<{
      updates?: { updatedRange?: string };
    }>({
      method: 'POST',
      path: `/${encodeURIComponent(this.spreadsheetId)}/values/${encodeURIComponent(range)}:append`,
      query: [
        ['valueInputOption', 'RAW'],
        ['insertDataOption', 'INSERT_ROWS'],
      ],
      body: { values: [values] },
    });

    const updatedRange = json.updates?.updatedRange;
    const match = updatedRange ? /![A-Z]+(\d+)/.exec(updatedRange) : null;
    return {
      written: true,
      ...(updatedRange ? { updatedRange } : {}),
      ...(match ? { row: Number(match[1]) } : {}),
    };
  }

  async appendSopGap(row: SopGapRow): Promise<AppendOutcome> {
    return this.append(TABS.sopGaps, sopGapToValues(row));
  }

  async appendLeaveAudit(row: LeaveAuditRow): Promise<AppendOutcome> {
    return this.append(TABS.leaveAudit, leaveAuditToValues(row));
  }

  async replaceIqamaWatchlist(rows: IqamaWatchRow[]): Promise<AppendOutcome> {
    if (!this.tabsEnsured) await this.ensureTabs();
    const tab = TABS.iqamaWatchlist;
    const header = HEADERS[tab];

    // Snapshot semantics: clear, then write header plus current rows.
    await this.request({
      method: 'POST',
      path: `/${encodeURIComponent(this.spreadsheetId)}/values/${encodeURIComponent(a1(tab, 'A:ZZ'))}:clear`,
      body: {},
    });

    const values = [header as unknown as (string | number)[], ...rows.map(iqamaWatchToValues)];
    const range = a1(tab, `A1:${colLetter(header.length)}${values.length}`);
    await this.request({
      method: 'PUT',
      path: `/${encodeURIComponent(this.spreadsheetId)}/values/${encodeURIComponent(range)}`,
      query: [['valueInputOption', 'RAW']],
      body: { range, majorDimension: 'ROWS', values },
    });

    return { written: true, updatedRange: range, row: values.length };
  }

  async readOpsSummary(windowDays = 7): Promise<OpsSummary> {
    const ranges: Array<[string, string]> = [
      ['ranges', a1(TABS.sopGaps, 'A2:J')],
      ['ranges', a1(TABS.leaveAudit, 'A2:L')],
      ['ranges', a1(TABS.iqamaWatchlist, 'A2:I')],
    ];

    const json = await this.request<{
      valueRanges?: Array<{ values?: unknown[][] }>;
    }>({
      method: 'GET',
      path: `/${encodeURIComponent(this.spreadsheetId)}/values:batchGet`,
      query: [...ranges, ['majorDimension', 'ROWS']],
    });

    const [gapRows = [], leaveRows = [], iqamaRows = []] = (json.valueRanges ?? []).map(
      (v) => v.values ?? [],
    );

    // Re-hydrate into the same shapes the fixture holds, then reuse one
    // summariser so live and fixture can never disagree about the numbers.
    return summarise(
      {
        sopGaps: gapRows.map(parseSopGap),
        leaveAudit: leaveRows.map(parseLeaveAudit),
        iqamaWatchlist: iqamaRows.map(parseIqamaWatch),
      },
      windowDays,
      this.now(),
    );
  }

  async health(): Promise<SheetsHealth> {
    try {
      const tabs = await this.listTabs();
      return {
        ok: true,
        mode: 'live',
        detail: `Connected to spreadsheet ${this.spreadsheetId} as ${this.key.client_email}.`,
        tabs: tabs.map((t) => t.title),
      };
    } catch (error) {
      return {
        ok: false,
        mode: 'live',
        detail: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Row parsing. Sheets returns ragged rows, so every field is defensive.       */
/* -------------------------------------------------------------------------- */

function str(row: unknown[], i: number): string {
  const v = row[i];
  return v === undefined || v === null ? '' : String(v);
}

function num(row: unknown[], i: number): number {
  const parsed = Number(str(row, i));
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseSopGap(row: unknown[]): SopGapRow {
  return {
    loggedAt: str(row, 0),
    reference: str(row, 1),
    employeeId: str(row, 2),
    country: (str(row, 3) || 'SA') as CountryCode,
    channel: str(row, 4),
    language: (str(row, 5) || 'en') as Language,
    question: str(row, 6),
    bestMatchScore: num(row, 7),
    status: (str(row, 8) || 'open') as SopGapRow['status'],
    assignedTo: str(row, 9),
  };
}

function parseLeaveAudit(row: unknown[]): LeaveAuditRow {
  return {
    recordedAt: str(row, 0),
    requestId: str(row, 1),
    employeeId: str(row, 2),
    employeeName: str(row, 3),
    country: (str(row, 4) || 'SA') as CountryCode,
    leaveType: str(row, 5),
    startDate: str(row, 6),
    endDate: str(row, 7),
    days: num(row, 8),
    decision: (str(row, 9) || 'submitted') as LeaveAuditRow['decision'],
    decidedBy: str(row, 10),
    channel: str(row, 11),
  };
}

function parseIqamaWatch(row: unknown[]): IqamaWatchRow {
  return {
    refreshedAt: str(row, 0),
    employeeId: str(row, 1),
    employeeName: str(row, 2),
    country: (str(row, 3) || 'SA') as CountryCode,
    document: str(row, 4),
    expiryDate: str(row, 5),
    daysRemaining: num(row, 6),
    severity: (str(row, 7) || 'ok') as IqamaSeverity,
    lineManager: str(row, 8),
  };
}
