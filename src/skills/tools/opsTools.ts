/**
 * HR Ops dashboard tools.
 *
 * These read the Google Sheet back, which is what makes the Sheets integration
 * two-way rather than a write-only audit dump. HR can ask the agent what the
 * control sheet says instead of opening it.
 *
 * Everything here is gated to HR staff by `condition()`, which the platform
 * evaluates fail-closed: if the check errors or times out, the tool is hidden.
 */
import { z } from 'zod';
import type { LuaTool } from 'lua-cli';

import { getOpsSheet, sheetsDegradedReason } from '../../services/sheets/index.js';
import { getHris, hrisDegradedReason } from '../../services/bamboohr/index.js';
import { t } from '../../services/i18n.js';
import { currentEmployee, currentLanguage } from './calculationTools.js';

export class GetOpsSummaryTool implements LuaTool {
  name = 'get_ops_summary';
  description =
    'HR only. Read the HR Ops control sheet and summarise it: knowledge-base gaps logged, leave ' +
    'decisions made, days approved, and the residency-permit watchlist by urgency. Use for "how did ' +
    'this week look", "how many gaps do we have", or "what needs attention".';

  inputSchema = z.object({
    windowDays: z
      .number()
      .int()
      .min(1)
      .max(90)
      .default(7)
      .describe('Reporting window in days. Defaults to the last 7 days.'),
  });

  async condition(): Promise<boolean> {
    const me = await currentEmployee();
    return Boolean(me?.isHrStaff);
  }

  async execute(input: z.infer<typeof this.inputSchema>): Promise<unknown> {
    const language = await currentLanguage();
    const me = await currentEmployee();
    if (!me?.isHrStaff) return { ok: false, message: t('hrOnly', language) };

    const summary = await getOpsSheet().readOpsSummary(input.windowDays);

    return {
      ok: true,
      windowDays: summary.windowDays,
      generatedAt: summary.generatedAt,
      knowledgeGaps: {
        logged: summary.sopGaps.total,
        stillOpen: summary.sopGaps.open,
        mostAsked: summary.sopGaps.topQuestions,
      },
      leave: {
        submitted: summary.leave.submitted,
        approved: summary.leave.approved,
        rejected: summary.leave.rejected,
        daysApproved: summary.leave.daysApproved,
      },
      residencyPermits: {
        onWatchlist: summary.iqama.total,
        expired: summary.iqama.expired,
        critical: summary.iqama.critical,
        urgent: summary.iqama.urgent,
      },
      instruction:
        'Lead with anything expired or critical — those are people whose legal residency is at ' +
        'risk. Then the leave numbers, then the most-asked knowledge gaps as a list of SOPs worth writing.',
    };
  }
}

/**
 * Diagnostics. Genuinely useful in a demo, because it makes visible which
 * backend each integration is actually talking to.
 */
export class SystemHealthTool implements LuaTool {
  name = 'check_system_health';
  description =
    'HR only. Report which backends the agent is connected to (live BambooHR and Google Sheets, or ' +
    'the local fixture stores) and whether they are reachable. Use when someone asks whether the ' +
    'agent is connected to real systems, or when something looks wrong.';

  inputSchema = z.object({});

  async condition(): Promise<boolean> {
    const me = await currentEmployee();
    return Boolean(me?.isHrStaff);
  }

  async execute(): Promise<unknown> {
    const [hris, sheet] = await Promise.all([getHris().health(), getOpsSheet().health()]);

    const degraded = [hrisDegradedReason(), sheetsDegradedReason()].filter(
      (r): r is string => r !== null,
    );

    return {
      ok: hris.ok && sheet.ok,
      hris: {
        mode: hris.mode,
        reachable: hris.ok,
        detail: hris.detail,
        employeeCount: hris.employeeCount,
      },
      opsSheet: {
        mode: sheet.mode,
        reachable: sheet.ok,
        detail: sheet.detail,
        tabs: sheet.tabs,
      },
      // Surfaced explicitly: a silent downgrade from live to fixture is exactly
      // the kind of thing that makes a demo look real when it is not.
      degradedFrom: degraded.length > 0 ? degraded : undefined,
      instruction:
        'State plainly whether each integration is live or running on fixtures. If either degraded ' +
        'from live, say so rather than implying a real connection.',
    };
  }
}

export const opsTools = [new GetOpsSummaryTool(), new SystemHealthTool()];
