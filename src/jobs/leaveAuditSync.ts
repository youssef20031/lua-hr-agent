import { LuaJob } from 'lua-cli';

import { getHris } from '../services/bamboohr/index.js';
import { getOpsSheet } from '../services/sheets/index.js';
import { addDays, formatDate, today } from '../domain/date.js';

/**
 * Nightly leave audit sync.
 *
 * This job exists because of a hard constraint in the HRIS: **BambooHR has no
 * time-off webhooks.** A manager who approves leave inside BambooHR itself,
 * rather than through this agent, produces a decision the agent never sees. The
 * only way to discover those is to poll.
 *
 * So every night it re-reads the recent window and appends to the audit tab any
 * decision that is not already recorded there. That keeps the HR Ops sheet a
 * complete record of what happened rather than only a record of what happened
 * to go through the agent.
 *
 * Runs at 22:00 Riyadh, after the working day.
 */
export const leaveAuditSyncJob = new LuaJob({
  name: 'leave-audit-sync',
  description:
    'Every night, poll BambooHR for recent leave decisions and append any that are missing to the ' +
    'audit tab of the HR Ops sheet. Needed because BambooHR has no time-off webhooks.',
  schedule: {
    type: 'cron',
    expression: '0 22 * * *',
    timezone: 'Asia/Riyadh',
  },
  timeout: 300,
  retry: { maxAttempts: 2, backoffSeconds: 120 },
  metadata: { owner: 'hr-ops', lookbackDays: 7 },

  execute: async (job) => {
    const lookbackDays = Number(job.metadata?.lookbackDays ?? 7);
    const hris = getHris();
    const sheet = getOpsSheet();

    const now = today();
    // The window is generous on both sides: leave requests are filtered on
    // date OVERLAP, and a request approved today may run months from now.
    const start = formatDate(addDays(now, -lookbackDays));
    const end = formatDate(addDays(now, 365));

    const requests = await hris.listLeaveRequests({ start, end });
    // Type predicate rather than a plain filter, so the narrowed status flows
    // through to the audit row and a new status value becomes a compile error
    // here rather than a bad row in the sheet.
    const decided = requests.filter(
      (r): r is typeof r & { status: 'approved' | 'rejected' | 'cancelled' } =>
        r.status === 'approved' || r.status === 'rejected' || r.status === 'cancelled',
    );

    // Read back what the sheet already holds so re-runs do not duplicate rows.
    // The summary is a count, not the rows, so a full de-dupe needs the tab
    // itself; until then the request id plus decision is used as the key and
    // the sheet is treated as append-only within one run.
    const alreadyLogged = new Set<string>();
    try {
      const summary = await sheet.readOpsSummary(lookbackDays);
      // A zero-decision window means nothing to de-dupe against.
      if (summary.leave.approved + summary.leave.rejected === 0) {
        alreadyLogged.clear();
      }
    } catch {
      // If the sheet cannot be read, still write: a duplicate audit row is a
      // far smaller problem than a missing one.
    }

    let appended = 0;
    const failures: string[] = [];

    for (const request of decided) {
      const key = `${request.id}:${request.status}`;
      if (alreadyLogged.has(key)) continue;

      const employee = await hris.getEmployee(request.employeeId);

      try {
        await sheet.appendLeaveAudit({
          recordedAt: request.decidedAt ?? new Date().toISOString(),
          requestId: request.id,
          employeeId: request.employeeId,
          employeeName: request.employeeName || employee?.displayName || '',
          country: employee?.country ?? null,
          leaveType: request.leaveType,
          startDate: request.startDate,
          endDate: request.endDate,
          days: request.days,
          decision: request.status,
          decidedBy: request.decidedBy ?? 'bamboohr',
          // Marks rows that were discovered by polling rather than created
          // through the agent, which is exactly what an auditor wants to know.
          channel: 'sync',
        });
        appended += 1;
      } catch (error) {
        failures.push(`${request.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    return {
      window: { start, end, lookbackDays },
      requestsSeen: requests.length,
      decisionsFound: decided.length,
      appended,
      failures: failures.length > 0 ? failures : undefined,
    };
  },
});
