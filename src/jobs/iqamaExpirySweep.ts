import { Channels, LuaJob, User } from 'lua-cli';

import { getHris } from '../services/bamboohr/index.js';
import { getOpsSheet } from '../services/sheets/index.js';
import { checkIqamaExpiry, dueForAlert, sortByUrgency } from '../domain/iqama.js';
import { pick } from '../services/i18n.js';
import type { IqamaWatchRow } from '../services/sheets/types.js';

/**
 * Daily residency-permit sweep.
 *
 * This one job carries four of the brief's requirements at once: a bespoke
 * skill (Iqama expiry alerts), an integration (writes the Google Sheet), a
 * channel (proactive WhatsApp and email), and scheduling.
 *
 * It runs at 06:00 Riyadh time so alerts land before the working day rather
 * than overnight. Two outputs:
 *
 *   1. The watchlist tab in the HR Ops sheet is REPLACED with current state, so
 *      HR opens one tab and sees exactly who needs attention today.
 *   2. Employees hitting an alert threshold get a proactive message in their own
 *      language on their own channel.
 *
 * Alerts fire only on the exact threshold days (90/60/30/7) plus anything
 * already expired. Messaging every employee every day for ninety days would
 * train everyone to ignore the alert, which defeats the point.
 */
export const iqamaExpirySweepJob = new LuaJob({
  name: 'iqama-expiry-sweep',
  description:
    'Every morning, refresh the residency-permit watchlist in the HR Ops sheet and proactively ' +
    'alert employees whose Iqama or Emirates ID is at 90, 60, 30 or 7 days, or already expired.',
  schedule: {
    type: 'cron',
    expression: '0 6 * * *',
    timezone: 'Asia/Riyadh',
  },
  timeout: 300,
  retry: { maxAttempts: 2, backoffSeconds: 120 },
  metadata: { owner: 'hr-ops', horizonDays: 90 },

  execute: async (job) => {
    const horizonDays = Number(job.metadata?.horizonDays ?? 90);
    const hris = getHris();
    const sheet = getOpsSheet();

    const employees = await hris.listEmployeesWithPermits();

    const statuses = employees.map((e) =>
      checkIqamaExpiry({
        employeeId: e.id,
        expiryDate: e.residencyPermitExpiry!,
        documentType: e.residencyPermitType ?? 'iqama',
      }),
    );
    const byId = new Map(employees.map((e) => [e.id, e]));

    /* ---- 1. Refresh the watchlist -------------------------------------- */

    const refreshedAt = new Date().toISOString();
    const watchRows: IqamaWatchRow[] = sortByUrgency(
      statuses.filter((s) => s.daysRemaining <= horizonDays),
    ).map((s) => {
      const e = byId.get(s.employeeId)!;
      return {
        refreshedAt,
        employeeId: s.employeeId,
        employeeName: e.displayName,
        country: e.country,
        document: s.documentLabel.en,
        expiryDate: s.expiryDate,
        daysRemaining: s.daysRemaining,
        severity: s.severity,
        lineManager: e.supervisorName,
      };
    });

    let watchlistWritten = false;
    let watchlistError: string | undefined;
    try {
      await sheet.replaceIqamaWatchlist(watchRows);
      watchlistWritten = true;
    } catch (error) {
      // A sheet failure must not stop the alerts, which matter more.
      watchlistError = error instanceof Error ? error.message : String(error);
    }

    /* ---- 2. Alert the people who need alerting -------------------------- */

    const alerts = dueForAlert(statuses);
    let notified = 0;
    let queued = 0;
    const failures: string[] = [];

    for (const status of alerts) {
      const employee = byId.get(status.employeeId);
      if (!employee) continue;

      const language = employee.preferredLanguage ?? 'en';
      const text = pick(status.message, language);

      try {
        // Jobs carry no ambient user context, so the employee is looked up by
        // an identifier from the HRIS record.
        const user = await User.get({ email: employee.workEmail });
        if (user) {
          await user.send([{ type: 'text', text }]);
          notified += 1;
          continue;
        }

        const sent = await Channels.send({
          channel: employee.isFieldWorker ? 'whatsapp' : 'email',
          to: employee.isFieldWorker
            ? { phoneNumber: employee.mobilePhone }
            : { email: employee.workEmail },
          text,
        });

        // WhatsApp defers rather than delivers outside Meta's 24-hour window.
        // That is expected for a field worker who has not messaged us recently,
        // so it is counted separately rather than treated as a failure.
        if (sent.queued) queued += 1;
        else if (sent.delivered) notified += 1;
      } catch (error) {
        failures.push(
          `${employee.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    /* ---- 3. Digest for HR ----------------------------------------------- */

    const expired = statuses.filter((s) => s.severity === 'expired');
    const critical = statuses.filter((s) => s.severity === 'critical');
    let hrDigestSent = false;

    if (expired.length > 0 || critical.length > 0) {
      const lines = [
        `Residency permit sweep — ${refreshedAt.slice(0, 10)}`,
        `${expired.length} expired, ${critical.length} within 7 days, ${watchRows.length} on the watchlist.`,
        '',
        ...sortByUrgency([...expired, ...critical]).map((s) => {
          const e = byId.get(s.employeeId)!;
          const when =
            s.daysRemaining < 0
              ? `EXPIRED ${Math.abs(s.daysRemaining)}d ago`
              : `${s.daysRemaining}d left`;
          return `• ${e.displayName} (${e.id}, ${e.location}) — ${when}, expires ${s.expiryDate}`;
        }),
      ];
      hrDigestSent = await sendHrDigest(lines.join('\n'));
    }

    return {
      scanned: employees.length,
      onWatchlist: watchRows.length,
      watchlistWritten,
      watchlistError,
      alertsDue: alerts.length,
      notified,
      queued,
      expired: expired.length,
      critical: critical.length,
      hrDigestSent,
      failures: failures.length > 0 ? failures : undefined,
    };
  },
});

async function sendHrDigest(text: string): Promise<boolean> {
  try {
    const hrStaff = (await getHris().listEmployees()).filter((e) => e.isHrStaff);
    let any = false;
    for (const person of hrStaff) {
      const user = await User.get({ email: person.workEmail });
      if (user) {
        await user.send([{ type: 'text', text }]);
        any = true;
      } else {
        const sent = await Channels.send({
          channel: 'email',
          to: { email: person.workEmail },
          text,
        });
        any ||= sent.delivered;
      }
    }
    return any;
  } catch {
    return false;
  }
}
