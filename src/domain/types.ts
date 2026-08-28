/**
 * Core domain types. Deliberately free of any `lua-cli` import so the legal
 * logic can be unit-tested in milliseconds and audited on its own.
 */

/** ISO 3166-1 alpha-2 for the four countries this employer operates in. */
export type CountryCode = 'SA' | 'AE' | 'EG' | 'JO';

export const COUNTRIES: readonly CountryCode[] = ['SA', 'AE', 'EG', 'JO'] as const;

export const COUNTRY_NAMES: Record<CountryCode, { en: string; ar: string }> = {
  SA: { en: 'Saudi Arabia', ar: 'المملكة العربية السعودية' },
  AE: { en: 'United Arab Emirates', ar: 'الإمارات العربية المتحدة' },
  EG: { en: 'Egypt', ar: 'مصر' },
  JO: { en: 'Jordan', ar: 'الأردن' },
};

/** Accepts the informal country labels people actually type, in both languages. */
const COUNTRY_ALIASES: Record<string, CountryCode> = {
  sa: 'SA', ksa: 'SA', saudi: 'SA', 'saudi arabia': 'SA', sau: 'SA',
  السعودية: 'SA', 'المملكة العربية السعودية': 'SA',
  ae: 'AE', uae: 'AE', emirates: 'AE', 'united arab emirates': 'AE', dubai: 'AE', 'abu dhabi': 'AE',
  الامارات: 'AE', الإمارات: 'AE', دبي: 'AE',
  eg: 'EG', egypt: 'EG', egy: 'EG', cairo: 'EG',
  مصر: 'EG', القاهرة: 'EG',
  jo: 'JO', jordan: 'JO', jor: 'JO', amman: 'JO',
  الاردن: 'JO', الأردن: 'JO', عمان: 'JO',
};

export function parseCountry(input: string): CountryCode | null {
  const key = input.trim().toLowerCase();
  return COUNTRY_ALIASES[key] ?? null;
}

export type Language = 'en' | 'ar';

export type LeaveType =
  | 'annual'
  | 'sick'
  | 'emergency'
  | 'unpaid'
  | 'maternity'
  | 'paternity'
  | 'hajj'
  | 'bereavement';

/**
 * Why employment ended. This drives the gratuity reduction tiers, which in
 * several of these jurisdictions differ sharply between quitting and being let go.
 */
export type SeparationReason =
  /** Employee resigned of their own accord. Often reduces the award. */
  | 'resignation'
  /** Employer terminated. Normally pays the full award. */
  | 'termination'
  /** Fixed-term contract reached its natural end. */
  | 'end_of_contract'
  /** Death, total disability, or another statutory full-award event. */
  | 'force_majeure';

/**
 * Every rule row carries its own provenance. `verified: false` means the figure
 * has NOT yet been confirmed against a primary source and must not be presented
 * to an employee as authoritative.
 */
export interface Provenance {
  /** e.g. "Saudi Labour Law, Article 84" */
  citation: string;
  /** URL the figure was checked against. */
  sourceUrl: string;
  /** True only once a human has confirmed the figure against a primary source. */
  verified: boolean;
  /** ISO date the figure was last checked. */
  lastReviewed: string;
  /** Anything a reader needs to know about scope or exceptions. */
  notes?: string;
}
