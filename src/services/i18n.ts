/**
 * Language detection and bilingual presentation.
 *
 * The agent must answer in the language it was addressed in. The model handles
 * most of that on its own, but three things need deterministic code:
 *
 *  1. Detecting the language of an inbound message reliably enough to store a
 *     preference, so a proactive message sent days later at 6am by a cron job
 *     goes out in the right language.
 *  2. Rendering tool output. A tool returns structured data with `en`/`ar`
 *     fields; something has to choose.
 *  3. Formatting numbers and dates in a way that does not look wrong in Arabic.
 */
import type { Language } from '../domain/types.js';
import type { Bilingual } from '../domain/gratuity.js';

/**
 * Letters only, by Unicode script. Digits are stripped before counting,
 * including Arabic-Indic digits (٠-٩): a year written as ٢٠٢٦ tells you the
 * writer uses Arabic numerals, not that the message is in Arabic, and a date
 * inside an otherwise-English sentence must not flip the reply language.
 * Latin digits are excluded for the same reason, so the two sides stay symmetric.
 */
const DIGITS = /\p{Nd}/gu;
const ARABIC_LETTERS = /\p{Script=Arabic}/gu;
const LATIN_LETTERS = /\p{Script=Latin}/gu;

/**
 * Detects the language of a message by script.
 *
 * Script detection rather than a language model because it is instant, free and
 * deterministic. It cannot distinguish Arabic from Farsi, which does not matter
 * for this employer, and it treats a mostly-Arabic message containing an English
 * product name as Arabic, which is the behaviour we want.
 *
 * Returns `null` when there is nothing to go on (digits, emoji, empty), so the
 * caller can fall back to a stored preference instead of guessing wrong.
 */
export function detectLanguage(text: string): Language | null {
  const letters = text.replace(DIGITS, '');
  const arabic = (letters.match(ARABIC_LETTERS) ?? []).length;
  const latin = (letters.match(LATIN_LETTERS) ?? []).length;

  if (arabic === 0 && latin === 0) return null;
  if (arabic === 0) return 'en';
  if (latin === 0) return 'ar';

  // Mixed script: Arabic wins unless it is clearly incidental. A single Arabic
  // greeting inside an English sentence should not flip the whole reply.
  return arabic / (arabic + latin) >= 0.2 ? 'ar' : 'en';
}

/** Detection with a fallback chain: message, then stored preference, then English. */
export function resolveLanguage(text: string, stored?: Language | null): Language {
  return detectLanguage(text) ?? stored ?? 'en';
}

/** Picks the right side of a bilingual pair. */
export function pick(value: Bilingual, language: Language): string {
  return language === 'ar' ? value.ar : value.en;
}

/** True when the text should be rendered right-to-left. */
export function isRtl(language: Language): boolean {
  return language === 'ar';
}

/**
 * Formats a money amount.
 *
 * Western Arabic numerals are used deliberately even in Arabic output: Gulf HR
 * and payroll documents overwhelmingly use them, and Arabic-Indic digits in a
 * payslip figure read as unusual rather than as a courtesy.
 */
export function formatMoney(amount: number, currency: string, language: Language): string {
  const formatted = amount.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return language === 'ar' ? `${formatted} ${currencyNameAr(currency)}` : `${formatted} ${currency}`;
}

function currencyNameAr(currency: string): string {
  const names: Record<string, string> = {
    SAR: 'ريال',
    AED: 'درهم',
    EGP: 'جنيه',
    JOD: 'دينار',
  };
  return names[currency] ?? currency;
}

/** Formats an ISO date for display. */
export function formatDateFor(iso: string, language: Language): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const [y, m, d] = iso.split('-') as [string, string, string];
  const monthsEn = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  const monthsAr = [
    'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
    'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
  ];
  const index = Number(m) - 1;
  const month = language === 'ar' ? monthsAr[index] : monthsEn[index];
  return `${Number(d)} ${month} ${y}`;
}

/** Pluralises a day count. Arabic dual and plural forms are handled properly. */
export function formatDays(count: number, language: Language): string {
  if (language === 'en') return `${count} ${count === 1 ? 'day' : 'days'}`;
  if (count === 1) return 'يوم واحد';
  if (count === 2) return 'يومان';
  if (count >= 3 && count <= 10) return `${count} أيام`;
  return `${count} يوماً`;
}

/**
 * Strings the agent needs in both languages outside of any tool result.
 * Kept in one table so a missing translation is a compile error, not a
 * silently English sentence in an Arabic conversation.
 */
export const STRINGS = {
  notIdentified: {
    en: 'I could not match you to an employee record. Please contact HR so they can link your account.',
    ar: 'لم أتمكن من مطابقتك بسجل موظف. يُرجى التواصل مع الموارد البشرية لربط حسابك.',
  },
  hrOnly: {
    en: 'That information is available to HR staff only.',
    ar: 'هذه المعلومات متاحة لموظفي الموارد البشرية فقط.',
  },
  noPermitOnFile: {
    en: 'There is no residency permit on file for you, which is expected outside Saudi Arabia and the UAE.',
    ar: 'لا يوجد تصريح إقامة مسجل لك، وهذا متوقع خارج السعودية والإمارات.',
  },
  escalated: {
    en: 'I have logged this with HR and they will follow up.',
    ar: 'لقد سجلت هذا لدى الموارد البشرية وسيتم التواصل معك.',
  },
  indicativeOnly: {
    en: 'This is an estimate. HR confirms the final figure.',
    ar: 'هذا تقدير تقريبي. تعتمد الموارد البشرية الرقم النهائي.',
  },
} as const satisfies Record<string, Bilingual>;

export type StringKey = keyof typeof STRINGS;

export function t(key: StringKey, language: Language): string {
  return pick(STRINGS[key], language);
}
