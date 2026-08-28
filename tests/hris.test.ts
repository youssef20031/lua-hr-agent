import { describe, it, expect, beforeEach } from 'vitest';
import {
  FixtureHrisClient,
  HrisError,
  HrisPermissionError,
  createHris,
  resolveHrisMode,
} from '../src/services/bamboohr/index.js';
import { checkIqamaExpiry, severityFor } from '../src/domain/iqama.js';

const REFERENCE = '2026-08-28';

let hris: FixtureHrisClient;

beforeEach(() => {
  hris = new FixtureHrisClient({ referenceDate: REFERENCE });
});

describe('employee lookup', () => {
  it('finds an employee by id', async () => {
    const e = await hris.getEmployee('E-1001');
    expect(e?.displayName).toBe('Ahmad Al-Otaibi');
    expect(e?.country).toBe('SA');
  });

  it('returns null for an unknown id', async () => {
    expect(await hris.getEmployee('E-9999')).toBeNull();
  });

  it('finds by work email, case-insensitively', async () => {
    const e = await hris.findEmployee({ email: 'AHMAD.ALOTAIBI@example.com' });
    expect(e?.id).toBe('E-1001');
  });

  it('finds by phone regardless of spacing or punctuation', async () => {
    const e = await hris.findEmployee({ phone: '+966 50 123 4001' });
    expect(e?.id).toBe('E-1001');
  });

  it('finds by Arabic display name', async () => {
    const e = await hris.findEmployee({ name: 'أحمد العتيبي' });
    expect(e?.id).toBe('E-1001');
  });

  it('returns null when nothing matches', async () => {
    expect(await hris.findEmployee({ email: 'nobody@example.com' })).toBeNull();
  });

  it('filters the directory by country', async () => {
    const uae = await hris.listEmployees({ country: 'AE' });
    expect(uae).toHaveLength(1);
    expect(uae[0]!.id).toBe('E-1005');
  });

  it('filters the directory by line manager', async () => {
    const reports = await hris.listEmployees({ supervisorId: 'M-2001' });
    expect(reports.map((e) => e.id).sort()).toEqual(['E-1001', 'E-1003', 'E-1004']);
  });

  it('covers all four operating countries', async () => {
    const all = await hris.listEmployees();
    expect(new Set(all.map((e) => e.country))).toEqual(new Set(['SA', 'AE', 'EG', 'JO']));
  });
});

describe('residency permits', () => {
  it('materialises expiry dates relative to the reference date', async () => {
    const e = await hris.getEmployee('E-1001');
    // Seeded at +30 days from the reference.
    expect(e?.residencyPermitExpiry).toBe('2026-09-27');
  });

  it('gives UAE staff an Emirates ID rather than an Iqama', async () => {
    const e = await hris.getEmployee('E-1005');
    expect(e?.residencyPermitType).toBe('emirates_id');
  });

  it('leaves Egyptian and Jordanian staff without a permit on file', async () => {
    expect((await hris.getEmployee('E-1006'))?.residencyPermitExpiry).toBeUndefined();
    expect((await hris.getEmployee('E-1007'))?.residencyPermitExpiry).toBeUndefined();
  });

  it('returns only permit holders for the sweep', async () => {
    const holders = await hris.listEmployeesWithPermits();
    expect(holders.every((e) => Boolean(e.residencyPermitExpiry))).toBe(true);
    expect(holders.map((e) => e.id)).not.toContain('E-1006');
  });

  it('populates every alert band, so the demo always has something to show', async () => {
    const holders = await hris.listEmployeesWithPermits();
    const severities = new Set(
      holders.map(
        (e) =>
          checkIqamaExpiry({
            employeeId: e.id,
            expiryDate: e.residencyPermitExpiry!,
            asOf: REFERENCE,
          }).severity,
      ),
    );
    for (const expected of ['expired', 'critical', 'urgent', 'warning', 'notice', 'ok']) {
      expect(severities, `missing a fixture employee in the "${expected}" band`).toContain(expected);
    }
  });

  it('keeps the bands correct at a different reference date', () => {
    // The offsets are relative, so the story holds whenever this is run.
    const later = new FixtureHrisClient({ referenceDate: '2030-01-15' });
    return later.listEmployeesWithPermits().then((holders) => {
      const bands = holders.map((e) => {
        const days = Math.round(
          (Date.parse(e.residencyPermitExpiry!) - Date.parse('2030-01-15')) / 86_400_000,
        );
        return severityFor(days);
      });
      expect(bands).toContain('expired');
      expect(bands).toContain('critical');
    });
  });
});

describe('leave balances', () => {
  it('applies the 30-day KSA entitlement to long-serving staff', async () => {
    const balances = await hris.getLeaveBalances('E-1001'); // hired 2018
    const annual = balances.find((b) => b.leaveType === 'annual')!;
    // 30 statutory days plus 5 carried over.
    expect(annual.entitlementDays).toBe(35);
  });

  it('applies the 21-day KSA entitlement to shorter service', async () => {
    const balances = await hris.getLeaveBalances('E-1002'); // hired 2023
    expect(balances.find((b) => b.leaveType === 'annual')!.entitlementDays).toBe(21);
  });

  it('subtracts used and pending days from what is available', async () => {
    const annual = (await hris.getLeaveBalances('E-1002')).find((b) => b.leaveType === 'annual')!;
    expect(annual.usedDays).toBe(4);
    expect(annual.pendingDays).toBe(5); // LR-5003 is pending
    expect(annual.availableDays).toBe(21 - 4 - 5);
  });

  it('never reports a negative balance', async () => {
    for (const id of ['E-1001', 'E-1002', 'E-1003', 'E-1005']) {
      for (const b of await hris.getLeaveBalances(id)) {
        expect(b.availableDays).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('uses the UAE rule for UAE staff', async () => {
    const annual = (await hris.getLeaveBalances('E-1005')).find((b) => b.leaveType === 'annual')!;
    expect(annual.entitlementDays).toBe(30);
  });

  it('rejects an unknown employee', async () => {
    await expect(hris.getLeaveBalances('E-9999')).rejects.toThrow(/was not found/);
  });
});

describe('leave requests', () => {
  it('lists an employee’s requests, newest first', async () => {
    const list = await hris.listLeaveRequests({ employeeId: 'E-1001' });
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((r) => r.employeeId === 'E-1001')).toBe(true);
  });

  it('filters by status', async () => {
    const pending = await hris.listLeaveRequests({ status: 'pending' });
    expect(pending.every((r) => r.status === 'pending')).toBe(true);
    expect(pending.map((r) => r.id)).toContain('LR-5003');
  });

  it('filters to what a given manager may approve', async () => {
    const approvable = await hris.listLeaveRequests({ approvableBy: 'M-2001' });
    expect(approvable.every((r) => ['E-1001', 'E-1003', 'E-1004'].includes(r.employeeId))).toBe(true);
  });

  it('filters on date overlap, not containment', async () => {
    // LR-5003 runs +21 to +25 days. A window that clips only its first day must still match.
    const overlapping = await hris.listLeaveRequests({
      employeeId: 'E-1002',
      start: '2026-09-18',
      end: '2026-09-19',
    });
    expect(overlapping.map((r) => r.id)).toContain('LR-5003');
  });

  it('creates a request in pending status with an inclusive day count', async () => {
    const created = await hris.createLeaveRequest({
      employeeId: 'E-1001',
      leaveType: 'annual',
      startDate: '2026-12-10',
      endDate: '2026-12-15',
      notes: 'Family visit',
    });
    expect(created.status).toBe('pending');
    expect(created.days).toBe(6);
    expect(created.employeeName).toBe('Ahmad Al-Otaibi');
  });

  it('makes a new request visible immediately', async () => {
    const created = await hris.createLeaveRequest({
      employeeId: 'E-1001',
      leaveType: 'annual',
      startDate: '2026-12-10',
      endDate: '2026-12-15',
    });
    expect(await hris.getLeaveRequest(created.id)).not.toBeNull();
  });

  it('counts a new pending request against the balance', async () => {
    const before = (await hris.getLeaveBalances('E-1001')).find((b) => b.leaveType === 'annual')!;
    await hris.createLeaveRequest({
      employeeId: 'E-1001',
      leaveType: 'annual',
      startDate: '2026-12-10',
      endDate: '2026-12-12',
    });
    const after = (await hris.getLeaveBalances('E-1001')).find((b) => b.leaveType === 'annual')!;
    expect(after.pendingDays).toBe(before.pendingDays + 3);
    expect(after.availableDays).toBe(before.availableDays - 3);
  });

  it('refuses a request that overlaps an existing one', async () => {
    await hris.createLeaveRequest({
      employeeId: 'E-1001',
      leaveType: 'annual',
      startDate: '2026-12-10',
      endDate: '2026-12-15',
    });
    await expect(
      hris.createLeaveRequest({
        employeeId: 'E-1001',
        leaveType: 'annual',
        startDate: '2026-12-14',
        endDate: '2026-12-20',
      }),
    ).rejects.toThrow(/overlaps an existing/);
  });

  it('refuses an end date before the start date', async () => {
    await expect(
      hris.createLeaveRequest({
        employeeId: 'E-1001',
        leaveType: 'annual',
        startDate: '2026-12-15',
        endDate: '2026-12-10',
      }),
    ).rejects.toThrow();
  });

  it('refuses a request for an unknown employee', async () => {
    await expect(
      hris.createLeaveRequest({
        employeeId: 'E-9999',
        leaveType: 'annual',
        startDate: '2026-12-10',
        endDate: '2026-12-12',
      }),
    ).rejects.toThrow(/was not found/);
  });
});

describe('approval authorisation', () => {
  it('lets the line manager approve', async () => {
    const decided = await hris.setLeaveRequestStatus('LR-5003', 'approved', 'M-2002', 'Enjoy Eid');
    expect(decided.status).toBe('approved');
    expect(decided.decidedBy).toBe('M-2002');
    expect(decided.decisionNote).toBe('Enjoy Eid');
  });

  it('lets HR staff approve anyone', async () => {
    const decided = await hris.setLeaveRequestStatus('LR-5003', 'approved', 'H-3001');
    expect(decided.status).toBe('approved');
  });

  it('refuses an unrelated colleague', async () => {
    await expect(hris.setLeaveRequestStatus('LR-5003', 'approved', 'E-1001')).rejects.toThrow(
      HrisPermissionError,
    );
  });

  it('refuses the wrong manager', async () => {
    // M-2001 manages E-1001/1003/1004, not E-1002.
    await expect(hris.setLeaveRequestStatus('LR-5003', 'approved', 'M-2001')).rejects.toThrow(
      /not the line manager/,
    );
  });

  it('lets an employee cancel their own request', async () => {
    const cancelled = await hris.setLeaveRequestStatus('LR-5003', 'cancelled', 'E-1002');
    expect(cancelled.status).toBe('cancelled');
  });

  it('does not let an employee approve their own request', async () => {
    await expect(hris.setLeaveRequestStatus('LR-5003', 'approved', 'E-1002')).rejects.toThrow(
      HrisPermissionError,
    );
  });

  it('refuses to decide a request twice', async () => {
    await hris.setLeaveRequestStatus('LR-5003', 'approved', 'M-2002');
    await expect(hris.setLeaveRequestStatus('LR-5003', 'rejected', 'M-2002')).rejects.toThrow(
      /already approved/,
    );
  });

  it('refuses an unknown request', async () => {
    await expect(hris.setLeaveRequestStatus('LR-0000', 'approved', 'M-2001')).rejects.toThrow(
      HrisError,
    );
  });

  it('frees the pending days once a request is rejected', async () => {
    const before = (await hris.getLeaveBalances('E-1002')).find((b) => b.leaveType === 'annual')!;
    await hris.setLeaveRequestStatus('LR-5003', 'rejected', 'M-2002');
    const after = (await hris.getLeaveBalances('E-1002')).find((b) => b.leaveType === 'annual')!;
    expect(after.pendingDays).toBe(before.pendingDays - 5);
  });
});

describe('time-off types', () => {
  it('exposes bilingual names for every type', async () => {
    const types = await hris.listTimeOffTypes();
    expect(types.length).toBeGreaterThan(3);
    for (const t of types) {
      expect(t.nameAr).toMatch(/[؀-ۿ]/);
    }
  });
});

describe('health and factory', () => {
  it('reports fixture mode as healthy', async () => {
    const h = await hris.health();
    expect(h.ok).toBe(true);
    expect(h.mode).toBe('fixture');
    expect(h.employeeCount).toBeGreaterThan(5);
  });

  it('defaults to fixture mode', () => {
    expect(resolveHrisMode({})).toBe('fixture');
    expect(resolveHrisMode({ HRIS_MODE: 'live' })).toBe('live');
    expect(resolveHrisMode({ HRIS_MODE: 'LIVE' })).toBe('live');
  });

  it('degrades to fixture when live is requested without credentials', () => {
    const client = createHris({ env: { HRIS_MODE: 'live' } });
    expect(client.mode).toBe('fixture');
  });
});
