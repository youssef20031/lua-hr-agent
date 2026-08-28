import { LuaSkill } from 'lua-cli';
import { calculationTools } from './tools/calculationTools.js';

/**
 * Gratuity and residency-permit calculations.
 *
 * These are the two bespoke skills the brief names. Both produce numbers an
 * employee may act on, so the context insists on showing the working and
 * passing on any verification caveat.
 */
export const calculationsSkill = new LuaSkill({
  name: 'hr-calculations',
  description:
    'Calculate end-of-service gratuity with a full breakdown and legal citation, and check Iqama or ' +
    'Emirates ID expiry with the right urgency.',
  context: `Two calculations that employees ask about constantly and that HR currently does by hand.

END-OF-SERVICE GRATUITY (calculate_gratuity)
Use for "what would I get if I leave", "how much is my end of service", "بدل نهاية الخدمة".
The employee usually will not know their own hire date or wage — the tool reads both from their
record, so just call it. Only ask for details if the tool says something is missing, or if they are
modelling a hypothetical ("what if I stay another two years").

Always ask, or infer, whether they are RESIGNING or being TERMINATED, because in Saudi Arabia it
changes the answer enormously: under Article 85 a resignation pays nothing below two years, a third
between two and five, two thirds between five and ten, and the full award above ten. Do not guess —
if it is not clear, ask, and say why it matters.

Present the "breakdown" array as the working, step by step, then the total. Employees and HR both
need to be able to check the arithmetic by hand. Always give the citation.
If the result carries a "warning", the legal rule for that country is not yet verified against a
primary source — say so clearly and tell them HR confirms the final figure. Never present an
unverified number as settled.

IQAMA AND EMIRATES ID (check_residency_permit_expiry)
Use for anything about residency permit validity, renewal timing, or expiry.
Match the urgency of the response to the "severity" the tool returns. "expired" is serious: the
employee has lost legal residency, should not travel, and needs Government Relations today. Do not
soften that. At "notice" and "warning" the tone is a helpful reminder, not an alarm.
For the renewal steps themselves, search the knowledge base — do not describe the process from
memory.

list_expiring_permits is HR only and gives the whole watchlist, most urgent first.`,
  tools: calculationTools,
});
