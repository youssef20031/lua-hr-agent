import { describe, it, expect, beforeEach } from 'vitest';
import {
  FixtureOpsSheetClient,
  createOpsSheet,
  resolveSheetsMode,
  summarise,
  HEADERS,
  TABS,
  iqamaWatchToValues,
  leaveAuditToValues,
  sopGapToValues,
  type IqamaWatchRow,
  type LeaveAuditRow,
  type SopGapRow,
} from '../src/services/sheets/index.js';
import { a1, colLetter, quoteSheetName } from '../src/services/sheets/http.js';
import { normalizePrivateKey, buildSignedJwt } from '../src/services/sheets/googleAuth.js';
import { createVerify, generateKeyPairSync } from 'node:crypto';

const NOW = new Date('2026-08-28T10:00:00Z');

function gap(over: Partial<SopGapRow> = {}): SopGapRow {
  return {
    loggedAt: NOW.toISOString(),
    reference: 'GAP-2026-0001',
    employeeId: 'E-1001',
    country: 'SA',
    channel: 'whatsapp',
    language: 'ar',
    question: 'How do I transfer my sponsorship to a new employer?',
    bestMatchScore: 0.41,
    status: 'open',
    assignedTo: 'hr-ops@example.com',
    ...over,
  };
}

function leave(over: Partial<LeaveAuditRow> = {}): LeaveAuditRow {
  return {
    recordedAt: NOW.toISOString(),
    requestId: 'LR-5001',
    employeeId: 'E-1001',
    employeeName: 'Ahmad Al-Otaibi',
    country: 'SA',
    leaveType: 'annual',
    startDate: '2026-09-10',
    endDate: '2026-09-15',
    days: 6,
    decision: 'approved',
    decidedBy: 'M-2001',
    channel: 'web',
    ...over,
  };
}

function watch(over: Partial<IqamaWatchRow> = {}): IqamaWatchRow {
  return {
    refreshedAt: NOW.toISOString(),
    employeeId: 'E-1001',
    employeeName: 'Ahmad Al-Otaibi',
    country: 'SA',
    document: 'Iqama',
    expiryDate: '2026-09-27',
    daysRemaining: 30,
    severity: 'urgent',
    lineManager: 'M-2001',
    ...over,
  };
}

describe('row serialisation', () => {
  it('emits every column the header declares, in order', () => {
    expect(sopGapToValues(gap())).toHaveLength(HEADERS[TABS.sopGaps].length);
    expect(leaveAuditToValues(leave())).toHaveLength(HEADERS[TABS.leaveAudit].length);
    expect(iqamaWatchToValues(watch())).toHaveLength(HEADERS[TABS.iqamaWatchlist].length);
  });

  it('preserves Arabic text unchanged', () => {
    const values = sopGapToValues(gap({ question: 'كيف أنقل كفالتي إلى صاحب عمل جديد؟' }));
    expect(values[6]).toBe('كيف أنقل كفالتي إلى صاحب عمل جديد؟');
  });

  it('keeps numeric fields numeric so the sheet can aggregate them', () => {
    expect(typeof sopGapToValues(gap())[7]).toBe('number');
    expect(typeof leaveAuditToValues(leave())[8]).toBe('number');
    expect(typeof iqamaWatchToValues(watch())[6]).toBe('number');
  });
});

describe('FixtureOpsSheetClient', () => {
  let client: FixtureOpsSheetClient;

  beforeEach(() => {
    client = new FixtureOpsSheetClient({ persist: false, now: () => NOW });
  });

  it('reports itself as fixture mode and healthy', async () => {
    const health = await client.health();
    expect(health.ok).toBe(true);
    expect(health.mode).toBe('fixture');
    expect(health.tabs).toEqual(Object.values(TABS));
  });

  it('stores an appended SOP gap and reports the row', async () => {
    const outcome = await client.appendSopGap(gap());
    expect(outcome.written).toBe(true);
    expect(outcome.row).toBe(2); // row 1 is the header
    expect(client.snapshot().sopGaps).toHaveLength(1);
  });

  it('increments the row number across appends', async () => {
    await client.appendSopGap(gap());
    const second = await client.appendSopGap(gap({ reference: 'GAP-2026-0002' }));
    expect(second.row).toBe(3);
  });

  it('appends leave audit rows independently of gaps', async () => {
    await client.appendSopGap(gap());
    const outcome = await client.appendLeaveAudit(leave());
    expect(outcome.row).toBe(2);
    expect(client.snapshot().leaveAudit).toHaveLength(1);
  });

  it('replaces rather than appends the Iqama watchlist', async () => {
    await client.replaceIqamaWatchlist([watch(), watch({ employeeId: 'E-1002' })]);
    await client.replaceIqamaWatchlist([watch({ employeeId: 'E-1003' })]);
    const snap = client.snapshot().iqamaWatchlist;
    expect(snap).toHaveLength(1);
    expect(snap[0]!.employeeId).toBe('E-1003');
  });

  it('starts empty and can be reset', async () => {
    await client.appendSopGap(gap());
    client.reset();
    expect(client.snapshot().sopGaps).toHaveLength(0);
  });
});

describe('ops summary', () => {
  const base = { sopGaps: [] as SopGapRow[], leaveAudit: [] as LeaveAuditRow[], iqamaWatchlist: [] as IqamaWatchRow[] };

  it('counts gaps inside the window and ignores older ones', () => {
    const old = gap({ loggedAt: new Date(NOW.getTime() - 30 * 86_400_000).toISOString() });
    const recent = gap();
    const s = summarise({ ...base, sopGaps: [old, recent] }, 7, NOW);
    expect(s.sopGaps.total).toBe(1);
  });

  it('counts only open gaps as open', () => {
    const s = summarise(
      { ...base, sopGaps: [gap(), gap({ status: 'published' }), gap({ status: 'open' })] },
      7,
      NOW,
    );
    expect(s.sopGaps.total).toBe(3);
    expect(s.sopGaps.open).toBe(2);
  });

  it('ranks the most frequently asked unanswered questions first', () => {
    const s = summarise(
      {
        ...base,
        sopGaps: [
          gap({ question: 'Spouse visa transfer' }),
          gap({ question: 'Spouse visa transfer' }),
          gap({ question: 'Company car policy' }),
        ],
      },
      7,
      NOW,
    );
    expect(s.sopGaps.topQuestions[0]).toEqual({ question: 'spouse visa transfer', count: 2 });
    expect(s.sopGaps.topQuestions[1]!.count).toBe(1);
  });

  it('groups questions case-insensitively', () => {
    const s = summarise(
      { ...base, sopGaps: [gap({ question: 'Exit re-entry' }), gap({ question: 'EXIT RE-ENTRY' })] },
      7,
      NOW,
    );
    expect(s.sopGaps.topQuestions).toHaveLength(1);
    expect(s.sopGaps.topQuestions[0]!.count).toBe(2);
  });

  it('caps the top-questions list at five', () => {
    const gaps = Array.from({ length: 12 }, (_, i) => gap({ question: `Question ${i}` }));
    const s = summarise({ ...base, sopGaps: gaps }, 7, NOW);
    expect(s.sopGaps.topQuestions).toHaveLength(5);
  });

  it('tallies leave decisions and approved days', () => {
    const s = summarise(
      {
        ...base,
        leaveAudit: [
          leave({ decision: 'approved', days: 6 }),
          leave({ decision: 'approved', days: 3 }),
          leave({ decision: 'rejected', days: 5 }),
          leave({ decision: 'submitted', days: 2 }),
        ],
      },
      7,
      NOW,
    );
    expect(s.leave.approved).toBe(2);
    expect(s.leave.rejected).toBe(1);
    expect(s.leave.submitted).toBe(1);
    expect(s.leave.daysApproved).toBe(9);
  });

  it('does not count rejected days towards approved days', () => {
    const s = summarise({ ...base, leaveAudit: [leave({ decision: 'rejected', days: 99 })] }, 7, NOW);
    expect(s.leave.daysApproved).toBe(0);
  });

  it('treats the watchlist as a snapshot, not a windowed log', () => {
    const stale = watch({ refreshedAt: new Date(NOW.getTime() - 60 * 86_400_000).toISOString() });
    const s = summarise({ ...base, iqamaWatchlist: [stale] }, 7, NOW);
    expect(s.iqama.total).toBe(1);
  });

  it('breaks the watchlist down by severity', () => {
    const s = summarise(
      {
        ...base,
        iqamaWatchlist: [
          watch({ severity: 'expired' }),
          watch({ severity: 'critical' }),
          watch({ severity: 'urgent' }),
          watch({ severity: 'urgent' }),
          watch({ severity: 'notice' }),
        ],
      },
      7,
      NOW,
    );
    expect(s.iqama).toMatchObject({ total: 5, expired: 1, critical: 1, urgent: 2 });
  });

  it('ignores rows with an unparseable timestamp rather than throwing', () => {
    const s = summarise({ ...base, sopGaps: [gap({ loggedAt: 'not a date' })] }, 7, NOW);
    expect(s.sopGaps.total).toBe(0);
  });

  it('reports the window it used', () => {
    expect(summarise(base, 30, NOW).windowDays).toBe(30);
  });
});

describe('A1 notation helpers', () => {
  it('quotes a plain tab name', () => {
    expect(quoteSheetName('SOP Gaps')).toBe("'SOP Gaps'");
  });

  it('doubles an embedded apostrophe', () => {
    expect(quoteSheetName("Jon's Data")).toBe("'Jon''s Data'");
  });

  it('quotes an Arabic tab name', () => {
    expect(quoteSheetName('المرشحون')).toBe("'المرشحون'");
  });

  it('builds a range with and without cells', () => {
    expect(a1('SOP Gaps', 'A:ZZ')).toBe("'SOP Gaps'!A:ZZ");
    expect(a1('SOP Gaps')).toBe("'SOP Gaps'");
  });

  it('encodes the colon in a range so :append stays unambiguous', () => {
    expect(encodeURIComponent(a1('SOP Gaps', 'A1:B2'))).toContain('%3A');
  });

  it('converts column numbers to letters', () => {
    expect(colLetter(1)).toBe('A');
    expect(colLetter(9)).toBe('I');
    expect(colLetter(26)).toBe('Z');
    expect(colLetter(27)).toBe('AA');
    expect(colLetter(52)).toBe('AZ');
  });

  it('spans every header column', () => {
    expect(colLetter(HEADERS[TABS.leaveAudit].length)).toBe('L');
  });
});

describe('service account key handling', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  it('repairs a PEM whose newlines were escaped by an environment variable', () => {
    const mangled = privateKey.replace(/\n/g, '\\n');
    expect(normalizePrivateKey(mangled)).toBe(privateKey.trimEnd() + '\n');
  });

  it('strips wrapping quotes left by a secret manager', () => {
    const quoted = `"${privateKey.replace(/\n/g, '\\n')}"`;
    expect(normalizePrivateKey(quoted)).toContain('-----BEGIN PRIVATE KEY-----');
  });

  it('normalises CRLF line endings', () => {
    expect(normalizePrivateKey(privateKey.replace(/\n/g, '\r\n'))).toBe(
      privateKey.trimEnd() + '\n',
    );
  });

  it('rejects something that is not a PEM', () => {
    expect(() => normalizePrivateKey('hunter2')).toThrow(/does not look like PEM/);
  });

  it('produces a three-segment JWT with URL-safe base64 and no padding', () => {
    const jwt = buildSignedJwt(
      { client_email: 'sa@example.iam.gserviceaccount.com', private_key: privateKey },
      'https://www.googleapis.com/auth/spreadsheets',
    );
    expect(jwt.split('.')).toHaveLength(3);
    expect(jwt).toMatch(/^[A-Za-z0-9_.-]+$/);
    expect(jwt).not.toContain('=');
  });

  it('signs the JWT verifiably with the private key', () => {
    const jwt = buildSignedJwt(
      { client_email: 'sa@example.iam.gserviceaccount.com', private_key: privateKey },
      'scope-x',
    );
    const [header, claims, signature] = jwt.split('.') as [string, string, string];
    const verifier = createVerify('RSA-SHA256');
    verifier.update(`${header}.${claims}`);
    verifier.end();
    expect(verifier.verify(publicKey, Buffer.from(signature, 'base64url'))).toBe(true);
  });

  it('carries the right claims and never exceeds a one-hour lifetime', () => {
    const jwt = buildSignedJwt(
      { client_email: 'sa@example.iam.gserviceaccount.com', private_key: privateKey },
      'scope-x',
      { lifetimeSeconds: 99_999 },
    );
    const claims = JSON.parse(
      Buffer.from(jwt.split('.')[1]!, 'base64url').toString('utf8'),
    ) as Record<string, number | string>;
    expect(claims.iss).toBe('sa@example.iam.gserviceaccount.com');
    expect(claims.scope).toBe('scope-x');
    expect(claims.aud).toBe('https://oauth2.googleapis.com/token');
    expect((claims.exp as number) - (claims.iat as number)).toBe(3600);
  });

  it('omits kid when no private_key_id is supplied', () => {
    const jwt = buildSignedJwt(
      { client_email: 'sa@example.iam.gserviceaccount.com', private_key: privateKey },
      'scope-x',
    );
    const header = JSON.parse(Buffer.from(jwt.split('.')[0]!, 'base64url').toString('utf8')) as Record<string, string>;
    expect(header.alg).toBe('RS256');
    expect(header.kid).toBeUndefined();
  });

  it('includes kid when a private_key_id is supplied', () => {
    const jwt = buildSignedJwt(
      { client_email: 'sa@example.iam.gserviceaccount.com', private_key: privateKey, private_key_id: 'abc123' },
      'scope-x',
    );
    const header = JSON.parse(Buffer.from(jwt.split('.')[0]!, 'base64url').toString('utf8')) as Record<string, string>;
    expect(header.kid).toBe('abc123');
  });
});

describe('factory', () => {
  it('defaults to fixture mode', () => {
    expect(resolveSheetsMode({})).toBe('fixture');
    expect(resolveSheetsMode({ SHEETS_MODE: 'fixture' })).toBe('fixture');
  });

  it('reads live mode from the environment, case-insensitively', () => {
    expect(resolveSheetsMode({ SHEETS_MODE: 'live' })).toBe('live');
    expect(resolveSheetsMode({ SHEETS_MODE: 'LIVE' })).toBe('live');
  });

  it('builds a fixture client by default', () => {
    const client = createOpsSheet({ env: {}, fixture: { persist: false } });
    expect(client.mode).toBe('fixture');
  });

  it('degrades to fixture when live is requested without a spreadsheet id', () => {
    const client = createOpsSheet({
      env: { SHEETS_MODE: 'live' },
      fixture: { persist: false },
    });
    // Falling back keeps the agent answering leave questions instead of dying.
    expect(client.mode).toBe('fixture');
  });
});
