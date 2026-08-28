import { LuaSkill } from 'lua-cli';
import { opsTools } from './tools/opsTools.js';
import { currentEmployee } from './tools/calculationTools.js';

/**
 * HR operations dashboard.
 *
 * Gated at the skill level as well as per tool: when the person is not HR
 * staff, the whole skill disappears — its tools and its context are both kept
 * out of the prompt, so the model does not know to offer something it cannot
 * do. The platform evaluates this fail-closed.
 */
export const hrOpsSkill = new LuaSkill({
  name: 'hr-ops-dashboard',
  description:
    'HR-only reporting over the HR Ops control sheet, plus integration health checks.',
  context: `HR-only tools that read the HR Ops control sheet in Google Sheets.

- get_ops_summary — the weekly picture: knowledge-base gaps logged, leave decisions, days approved,
  and the residency-permit watchlist broken down by urgency. Use for "how did this week look",
  "what needs attention", "how many gaps do we have".
- check_system_health — which backends are actually connected. Use when someone asks whether the
  agent is talking to real BambooHR and Google Sheets, or when results look wrong.

When reporting a summary, lead with anything expired or critical on the permit watchlist: those are
people whose legal residency is at risk and it is the most time-sensitive thing on the sheet. Then
leave activity, then the most-asked knowledge gaps, framed as the SOPs most worth writing next.

Be straight about system health. If an integration has degraded from live to a local fixture store,
say so rather than implying a real connection.`,
  tools: opsTools,
  condition: async () => {
    const me = await currentEmployee();
    return Boolean(me?.isHrStaff);
  },
});
