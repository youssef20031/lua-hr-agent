import { PreProcessor } from 'lua-cli';
import type { ChatMessage } from 'lua-cli';
import { detectLanguage } from '../services/i18n.js';

/**
 * Detects the language of each inbound message and remembers it on the user
 * record.
 *
 * The model is perfectly capable of replying in the language it was addressed
 * in, so this is not about the conversation itself. It is about everything that
 * happens OUTSIDE the conversation: when the Iqama sweep fires at 6am and sends
 * a proactive WhatsApp message, there is no inbound text to infer a language
 * from. Without a stored preference, a Saudi field worker who has only ever
 * written in Arabic gets an English alert about their residency permit.
 *
 * Runs synchronously — it is a regex over one string, and the stored value must
 * be correct before the turn is answered.
 */
export const languageDetectProcessor = new PreProcessor({
  name: 'language-detect',
  description:
    'Detects Arabic or English from the inbound message and persists it as the user preferred ' +
    'language, so proactive messages sent later go out in the right language.',
  async: false,
  priority: 10,

  execute: async (user, messages: ChatMessage[], channel: string) => {
    // Take the most recent text part; images and files carry no language signal.
    const lastText = [...messages]
      .reverse()
      .find((m): m is Extract<ChatMessage, { type: 'text' }> => m.type === 'text');

    if (!lastText?.text) {
      return { action: 'proceed' as const };
    }

    const detected = detectLanguage(lastText.text);
    if (!detected) {
      // Digits, emoji or an empty message: keep whatever we already knew.
      return { action: 'proceed' as const };
    }

    try {
      if (user.preferredLanguage !== detected) {
        await user.update({ preferredLanguage: detected, lastChannel: channel });
      }
    } catch (error) {
      // A preference write must never block a reply.
      // eslint-disable-next-line no-console
      console.warn(`[language-detect] could not persist preference: ${String(error)}`);
    }

    return {
      action: 'proceed' as const,
      metadata: { detectedLanguage: detected, channel },
    };
  },
});
