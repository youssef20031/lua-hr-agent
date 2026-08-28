/**
 * Fixture implementation of the HR Ops sheet.
 *
 * This is a faithful stand-in, not a stub: it stores rows, enforces the same
 * header shape, and answers `readOpsSummary` from the data it actually holds.
 * That matters because the summary logic is the part most likely to be wrong,
 * and testing it against the fixture exercises the same code path the live
 * client uses.
 *
 * State persists to a JSON file so a demo survives a restart. Set
 * `SHEETS_FIXTURE_PATH` to relocate it, or pass `persist: false` for tests.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  HEADERS,
  TABS,
  type AppendOutcome,
  type IqamaWatchRow,
  type LeaveAuditRow,
  type OpsSheetClient,
  type OpsSummary,
  type SheetsHealth,
  type SopGapRow,
} from './types.js';

interface FixtureState {
  sopGaps: SopGapRow[];
  leaveAudit: LeaveAuditRow[];
  iqamaWatchlist: IqamaWatchRow[];
}

const EMPTY: FixtureState = { sopGaps: [], leaveAudit: [], iqamaWatchlist: [] };

export interface FixtureOptions {
  /** Where to persist. Defaults to SHEETS_FIXTURE_PATH or .local/ops-sheet.json */
  path?: string;
  /** Set false in tests to keep everything in memory. */
  persist?: boolean;
  /** Fixed clock for deterministic tests. */
  now?: () => Date;
}

export class FixtureOpsSheetClient implements OpsSheetClient {
  readonly mode = 'fixture' as const;

  private state: FixtureState;
  private readonly path: string;
  private readonly persist: boolean;
  private readonly now: () => Date;
  private tabsReady = false;

  constructor(opts: FixtureOptions = {}) {
    this.persist = opts.persist ?? true;
    this.path = resolve(
      opts.path ?? process.env.SHEETS_FIXTURE_PATH ?? '.local/ops-sheet.json',
    );
    this.now = opts.now ?? (() => new Date());
    this.state = this.persist ? this.load() : structuredClone(EMPTY);
  }

  private load(): FixtureState {
    if (!existsSync(this.path)) return structuredClone(EMPTY);
    try {
      const parsed = JSON.parse(readFileSync(this.path, 'utf8')) as Partial<FixtureState>;
      return {
        sopGaps: parsed.sopGaps ?? [],
        leaveAudit: parsed.leaveAudit ?? [],
        iqamaWatchlist: parsed.iqamaWatchlist ?? [],
      };
    } catch {
      // A corrupt fixture file must not take the agent down; start clean.
      return structuredClone(EMPTY);
    }
  }

  private save(): void {
    if (!this.persist) return;
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(this.state, null, 2), 'utf8');
  }

  async ensureTabs(): Promise<void> {
    this.tabsReady = true;
    this.save();
  }

  async appendSopGap(row: SopGapRow): Promise<AppendOutcome> {
    this.state.sopGaps.push(row);
    this.save();
    return this.outcome(TABS.sopGaps, this.state.sopGaps.length);
  }

  async appendLeaveAudit(row: LeaveAuditRow): Promise<AppendOutcome> {
    this.state.leaveAudit.push(row);
    this.save();
    return this.outcome(TABS.leaveAudit, this.state.leaveAudit.length);
  }

  async replaceIqamaWatchlist(rows: IqamaWatchRow[]): Promise<AppendOutcome> {
    this.state.iqamaWatchlist = [...rows];
    this.save();
    return this.outcome(TABS.iqamaWatchlist, rows.length);
  }

  private outcome(tab: string, count: number): AppendOutcome {
    // Row 1 is the header, so data starts at row 2.
    const row = count + 1;
    return { written: true, updatedRange: `'${tab}'!A${row}`, row };
  }

  async readOpsSummary(windowDays = 7): Promise<OpsSummary> {
    return summarise(this.state, windowDays, this.now());
  }

  async health(): Promise<SheetsHealth> {
    return {
      ok: true,
      mode: 'fixture',
      detail: this.persist
        ? `Fixture store at ${this.path}. No Google credentials in use.`
        : 'In-memory fixture store. No Google credentials in use.',
      tabs: Object.values(TABS),
    };
  }

  /** Test/demo helper: wipes the store. */
  reset(): void {
    this.state = structuredClone(EMPTY);
    this.tabsReady = false;
    this.save();
  }

  /** Test helper: direct read of what has been written. */
  snapshot(): FixtureState {
    return structuredClone(this.state);
  }
}

/**
 * Summary logic, shared by the fixture and (via row parsing) the live client.
 * Exported so it can be tested directly against known input.
 */
export function summarise(state: FixtureState, windowDays: number, now: Date): OpsSummary {
  const cutoff = new Date(now.getTime() - windowDays * 86_400_000);
  const inWindow = (iso: string): boolean => {
    const t = Date.parse(iso);
    return Number.isFinite(t) && t >= cutoff.getTime();
  };

  const gaps = state.sopGaps.filter((g) => inWindow(g.loggedAt));
  const leave = state.leaveAudit.filter((l) => inWindow(l.recordedAt));

  // Group identical questions so HR sees what people keep asking for.
  const counts = new Map<string, number>();
  for (const g of gaps) {
    const key = g.question.trim().toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const topQuestions = [...counts.entries()]
    .map(([question, count]) => ({ question, count }))
    .sort((a, b) => b.count - a.count || a.question.localeCompare(b.question))
    .slice(0, 5);

  const approved = leave.filter((l) => l.decision === 'approved');

  return {
    generatedAt: now.toISOString(),
    windowDays,
    sopGaps: {
      total: gaps.length,
      open: gaps.filter((g) => g.status === 'open').length,
      topQuestions,
    },
    leave: {
      submitted: leave.filter((l) => l.decision === 'submitted').length,
      approved: approved.length,
      rejected: leave.filter((l) => l.decision === 'rejected').length,
      daysApproved: approved.reduce((sum, l) => sum + l.days, 0),
    },
    iqama: {
      // The watchlist is a snapshot, so it is not filtered by the window.
      total: state.iqamaWatchlist.length,
      expired: state.iqamaWatchlist.filter((r) => r.severity === 'expired').length,
      critical: state.iqamaWatchlist.filter((r) => r.severity === 'critical').length,
      urgent: state.iqamaWatchlist.filter((r) => r.severity === 'urgent').length,
    },
  };
}

/** Re-exported so the live client can validate its header row against the same source. */
export { HEADERS };
