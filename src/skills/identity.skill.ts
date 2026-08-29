import { LuaSkill } from 'lua-cli';
import { identityTools } from './tools/identityTools.js';

/**
 * Account linking.
 *
 * Exists because the two channels identify people differently: WhatsApp hands
 * over the sender's number, the web widget hands over nothing. Rather than
 * weaken the rule that identity comes from the channel, this proves possession
 * of a channel the HRIS already holds for that employee.
 *
 * The context is written to keep the model from doing the obvious wrong thing —
 * accepting "I am Ahmad" as identification, offering to link somebody else, or
 * treating a completed link as permanent when the browser it lives in is not.
 */
export const identitySkill = new LuaSkill({
  name: 'account-linking',
  description:
    'Link an unidentified conversation to an employee record by sending a one-time code to the ' +
    'phone or email already held for that employee.',
  context: `Handles the case where the agent does not know who it is talking to.

WHEN THIS COMES UP
On WhatsApp the sender's phone number identifies them, so this almost never applies. On the web
portal nobody is identified: any request for a balance, a leave submission, a gratuity figure or a
permit date will come back saying the employee record could not be matched. That is when to offer
linking.

HOW IT GOES
1. Ask for their employee id. Nothing else identifies a record.
2. Call request_account_link with it. A code goes to the phone or email ON THAT EMPLOYEE'S RECORD.
3. Ask them for the code, then call confirm_account_link.
4. Once it succeeds, carry on with what they originally asked for. Do not make them repeat it.

The code lasts ten minutes and there are three attempts. If it expires, start again from the
employee id. If the attempts run out, the request is closed and only HR can help — say so plainly
and do not offer to retry.

WHAT NOT TO DO
- A name is not identification. If someone says "I am Ahmad" or "this is Fatima", do not treat them
  as that person and do not look anything up. Offer to link instead. Anyone could type a name, and
  the record behind it holds salary and end-of-service figures.
- Never offer to send the code somewhere the employee suggests. The whole point is that it goes to
  the address the employer already has. If they say the number on file is wrong, that is an HR
  task, not something to work around.
- Do not confirm or deny whether an employee id exists. The tool is deliberately vague about that;
  keep it that way rather than helpfully filling in the gap.
- Do not link somebody who is already identified, and never link one person to another person's id.

ENDING IT
A link lasts twelve hours and then lapses on its own. Call unlink_account the moment somebody says
they are finished, is handing the computer back, is on a shared or public machine, or asks to be
signed out, unlinked or forgotten. Do not ask them to confirm and do not talk them out of it — the
web portal is reached from shared desks and demo laptops, and the chat window is restored from the
browser rather than started fresh, so the next person to open it would otherwise arrive already
holding this person's salary and end-of-service figures.

If they would rather not link, they can still ask anything that is not about them personally: SOPs,
policies, and the statutory entitlement rules for any of the four countries.`,
  tools: identityTools,
});
