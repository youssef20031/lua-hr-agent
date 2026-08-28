/**
 * The HR Ops control sheet.
 *
 * The interface is deliberately domain-shaped: it talks about SOP gaps, leave
 * decisions and Iqama watchlists, not about A1 ranges and value input options.
 * Tools depend on this, never on the Google API, which is what lets the fixture
 * implementation be a faithful stand-in rather than a stub.
 */
import type { CountryCode, Language } from '../../domain/types.js';
import type { IqamaSeverity } from '../../domain/iqama.js';

/** Tab titles. Kept here so the fixture and the real client cannot drift apart. */
export const TABS = {
  sopGaps: 'SOP Gaps',
  leaveAudit: 'Leave Audit',
  iqamaWatchlist: 'Iqama Watchlist',
} as const;

export type TabName = (typeof TABS)[keyof typeof TABS];

/**
 * Column headers, in order. These double as the header row written at bootstrap
 * and as the shape every append must match.
 */
export const HEADERS: Record<TabName, readonly string[]> = {
  [TABS.sopGaps]: [
    'Logged At',
    'Reference',
    'Employee ID',
    'Country',
    'Channel',
    'Language',
    'Question',
    'Best Match Score',
    'Status',
    'Assigned To',
  ],
  [TABS.leaveAudit]: [
    'Recorded At',
    'Request ID',
    'Employee ID',
    'Employee Name',
    'Country',
    'Leave Type',
    'Start Date',
    'End Date',
    'Days',
    'Decision',
    'Decided By',
    'Channel',
  ],
  [TABS.iqamaWatchlist]: [
    'Refreshed At',
    'Employee ID',
    'Employee Name',
    'Country',
    'Document',
    'Expiry Date',
    'Days Remaining',
    'Severity',
    'Line Manager',
  ],
};

export interface SopGapRow {
  loggedAt: string;
  /** Human-quotable reference handed back to the employee, e.g. GAP-2026-0042. */
  reference: string;
  employeeId: string;
  country: CountryCode;
  channel: string;
  language: Language;
  /** The question the knowledge base could not answer. */
  question: string;
  /** Best semantic-search score achieved, so HR can see how close it was. */
  bestMatchScore: number;
  status: 'open' | 'in_progress' | 'published' | 'rejected';
  assignedTo: string;
}

export interface LeaveAuditRow {
  recordedAt: string;
  requestId: string;
  employeeId: string;
  employeeName: string;
  country: CountryCode;
  leaveType: string;
  startDate: string;
  endDate: string;
  days: number;
  decision: 'submitted' | 'approved' | 'rejected' | 'cancelled';
  decidedBy: string;
  channel: string;
}

export interface IqamaWatchRow {
  refreshedAt: string;
  employeeId: string;
  employeeName: string;
  country: CountryCode;
  document: string;
  expiryDate: string;
  daysRemaining: number;
  severity: IqamaSeverity;
  lineManager: string;
}

export interface AppendOutcome {
  /** True when the row reached the sheet (or the fixture store). */
  written: boolean;
  /** A1 range the row landed in, when the backend reports one. */
  updatedRange?: string;
  /** Row number assigned, when known. */
  row?: number;
}

export interface OpsSummary {
  generatedAt: string;
  windowDays: number;
  sopGaps: {
    total: number;
    open: number;
    /** Most frequently asked unanswered questions, most common first. */
    topQuestions: Array<{ question: string; count: number }>;
  };
  leave: {
    submitted: number;
    approved: number;
    rejected: number;
    /** Total leave days approved in the window. */
    daysApproved: number;
  };
  iqama: {
    total: number;
    expired: number;
    critical: number;
    urgent: number;
  };
}

export interface SheetsHealth {
  ok: boolean;
  mode: 'live' | 'fixture';
  detail: string;
  /** Tabs the backend can see. */
  tabs?: string[];
}

/**
 * What the HR Ops sheet can do. Both the live Google client and the fixture
 * client implement this exactly.
 */
export interface OpsSheetClient {
  readonly mode: 'live' | 'fixture';

  /** Creates any missing tabs and writes their header rows. Idempotent. */
  ensureTabs(): Promise<void>;

  appendSopGap(row: SopGapRow): Promise<AppendOutcome>;
  appendLeaveAudit(row: LeaveAuditRow): Promise<AppendOutcome>;

  /**
   * The watchlist is a snapshot rather than a log: the daily sweep replaces it
   * wholesale so HR always sees current state, not an ever-growing history.
   */
  replaceIqamaWatchlist(rows: IqamaWatchRow[]): Promise<AppendOutcome>;

  /** Reads the sheet back, which is what makes this a two-way integration. */
  readOpsSummary(windowDays?: number): Promise<OpsSummary>;

  /** Cheap probe: proves credentials, API enablement, sheet ID and sharing. */
  health(): Promise<SheetsHealth>;
}

/** Turns a typed row into the flat array the Sheets API wants, header-order. */
export function sopGapToValues(r: SopGapRow): (string | number)[] {
  return [
    r.loggedAt,
    r.reference,
    r.employeeId,
    r.country,
    r.channel,
    r.language,
    r.question,
    r.bestMatchScore,
    r.status,
    r.assignedTo,
  ];
}

export function leaveAuditToValues(r: LeaveAuditRow): (string | number)[] {
  return [
    r.recordedAt,
    r.requestId,
    r.employeeId,
    r.employeeName,
    r.country,
    r.leaveType,
    r.startDate,
    r.endDate,
    r.days,
    r.decision,
    r.decidedBy,
    r.channel,
  ];
}

export function iqamaWatchToValues(r: IqamaWatchRow): (string | number)[] {
  return [
    r.refreshedAt,
    r.employeeId,
    r.employeeName,
    r.country,
    r.document,
    r.expiryDate,
    r.daysRemaining,
    r.severity,
    r.lineManager,
  ];
}
