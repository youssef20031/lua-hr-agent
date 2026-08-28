import { describe, it, expect } from 'vitest';
import {
  detectLanguage,
  resolveLanguage,
  pick,
  formatDays,
  formatMoney,
  formatDateFor,
  isRtl,
  t,
  STRINGS,
} from '../src/services/i18n.js';
import { toPlainText } from '../src/processors/channelShape.post.js';

describe('detectLanguage', () => {
  it('detects plain English', () => {
    expect(detectLanguage('How many annual leave days do I have?')).toBe('en');
  });

  it('detects plain Arabic', () => {
    expect(detectLanguage('كم عدد أيام الإجازة السنوية المتبقية لي؟')).toBe('ar');
  });

  it('treats a mostly-Arabic message with an English word as Arabic', () => {
    expect(detectLanguage('أريد تقديم طلب إجازة على WhatsApp')).toBe('ar');
  });

  it('treats an English sentence with one Arabic greeting as English', () => {
    // A single incidental Arabic word must not flip the whole reply.
    expect(detectLanguage('Hi, I wanted to ask about my leave balance please سلام')).toBe('en');
  });

  it('returns null when there is no linguistic signal', () => {
    expect(detectLanguage('')).toBeNull();
    expect(detectLanguage('12345')).toBeNull();
    expect(detectLanguage('👍')).toBeNull();
    expect(detectLanguage('2026-09-10')).toBeNull();
  });

  it('handles Arabic-Indic digits without treating them as Arabic text', () => {
    // Digits alone carry no language; there must be actual script.
    expect(detectLanguage('٢٠٢٦')).toBeNull();
  });
});

describe('resolveLanguage', () => {
  it('prefers the detected language', () => {
    expect(resolveLanguage('مرحبا', 'en')).toBe('ar');
  });

  it('falls back to the stored preference when nothing is detectable', () => {
    expect(resolveLanguage('👍', 'ar')).toBe('ar');
  });

  it('falls back to English when there is nothing at all', () => {
    expect(resolveLanguage('', null)).toBe('en');
    expect(resolveLanguage('')).toBe('en');
  });
});

describe('bilingual formatting', () => {
  it('picks the right side of a pair', () => {
    const pair = { en: 'Annual leave', ar: 'إجازة سنوية' };
    expect(pick(pair, 'en')).toBe('Annual leave');
    expect(pick(pair, 'ar')).toBe('إجازة سنوية');
  });

  it('marks Arabic as right-to-left', () => {
    expect(isRtl('ar')).toBe(true);
    expect(isRtl('en')).toBe(false);
  });

  it('uses correct Arabic singular, dual and plural forms for days', () => {
    expect(formatDays(1, 'ar')).toBe('يوم واحد');
    expect(formatDays(2, 'ar')).toBe('يومان');
    expect(formatDays(5, 'ar')).toBe('5 أيام');
    expect(formatDays(21, 'ar')).toBe('21 يوماً');
  });

  it('pluralises English days', () => {
    expect(formatDays(1, 'en')).toBe('1 day');
    expect(formatDays(6, 'en')).toBe('6 days');
  });

  it('formats money with the Arabic currency name', () => {
    expect(formatMoney(44043.84, 'SAR', 'en')).toBe('44,043.84 SAR');
    expect(formatMoney(44043.84, 'SAR', 'ar')).toBe('44,043.84 ريال');
  });

  it('keeps Western Arabic numerals in Arabic output', () => {
    // Gulf payslips and government documents use these; Arabic-Indic digits
    // in a payroll figure read as unusual rather than as a courtesy.
    expect(formatMoney(1234.5, 'AED', 'ar')).toMatch(/1,234\.50/);
  });

  it('formats dates with localised month names', () => {
    expect(formatDateFor('2026-09-10', 'en')).toBe('10 September 2026');
    expect(formatDateFor('2026-09-10', 'ar')).toBe('10 سبتمبر 2026');
  });

  it('passes through anything that is not an ISO date', () => {
    expect(formatDateFor('next Sunday', 'en')).toBe('next Sunday');
  });

  it('has a real Arabic translation for every canned string', () => {
    for (const [key, pair] of Object.entries(STRINGS)) {
      expect(pair.en.length, key).toBeGreaterThan(0);
      expect(pair.ar, key).toMatch(/[؀-ۿ]/);
    }
  });

  it('resolves canned strings by key', () => {
    expect(t('hrOnly', 'ar')).toBe(STRINGS.hrOnly.ar);
  });
});

describe('toPlainText — reshaping for WhatsApp', () => {
  it('turns a component block into plain bullet lines', () => {
    const input = 'Choose one:\n::: actions\n- Check balance\n- Submit request\n:::';
    const out = toPlainText(input);
    expect(out).toContain('• Check balance');
    expect(out).toContain('• Submit request');
    expect(out).not.toContain(':::');
  });

  it('removes a stray or malformed component fence', () => {
    expect(toPlainText('Hello\n::: actions\nWorld')).not.toContain(':::');
  });

  it('flattens a markdown table into label and value lines', () => {
    const input = [
      '| Leave type | Available |',
      '| --- | --- |',
      '| Annual | 21 |',
      '| Sick | 30 |',
    ].join('\n');
    const out = toPlainText(input);
    expect(out).toContain('Leave type: Annual');
    expect(out).toContain('Available: 21');
    expect(out).toContain('Leave type: Sick');
    expect(out).not.toContain('|');
  });

  it('flattens an Arabic table, which is where alignment breaks worst', () => {
    const input = ['| النوع | المتاح |', '| --- | --- |', '| سنوية | 21 |'].join('\n');
    const out = toPlainText(input);
    expect(out).toContain('النوع: سنوية');
    expect(out).toContain('المتاح: 21');
    expect(out).not.toContain('|');
  });

  it('leaves a line containing a pipe alone when it is not a table', () => {
    expect(toPlainText('Use a | b to pipe output')).toBe('Use a | b to pipe output');
  });

  it('converts double-asterisk bold to the single form WhatsApp renders', () => {
    expect(toPlainText('This is **important**')).toBe('This is *important*');
  });

  it('strips underscore emphasis, which collides with transliteration', () => {
    expect(toPlainText('the _annual_ leave')).toBe('the annual leave');
  });

  it('keeps heading text but drops the hashes', () => {
    expect(toPlainText('## Leave balance')).toBe('Leave balance');
  });

  it('renders a markdown link as label plus bare url', () => {
    expect(toPlainText('See [the policy](https://example.com/p)')).toBe(
      'See the policy: https://example.com/p',
    );
  });

  it('collapses the blank lines all that leaves behind', () => {
    expect(toPlainText('A\n\n\n\n\nB')).toBe('A\n\nB');
  });

  it('leaves ordinary prose untouched', () => {
    const prose = 'You have 21 days available. Your next step-up is on 1 March 2028.';
    expect(toPlainText(prose)).toBe(prose);
  });

  it('preserves Arabic text exactly', () => {
    const arabic = 'لديك 21 يوماً من الإجازة السنوية المتاحة.';
    expect(toPlainText(arabic)).toBe(arabic);
  });

  it('handles a realistic mixed reply end to end', () => {
    const input = [
      '## Your leave balance',
      '',
      '| Type | Days |',
      '| --- | --- |',
      '| Annual | 21 |',
      '',
      'See [the policy](https://example.com/leave) for **full details**.',
      '',
      '::: actions',
      '- Submit a request',
      ':::',
    ].join('\n');
    const out = toPlainText(input);
    expect(out).not.toMatch(/[|#]|:::|\*\*/);
    expect(out).toContain('Type: Annual');
    expect(out).toContain('• Submit a request');
    expect(out).toContain('https://example.com/leave');
  });
});
