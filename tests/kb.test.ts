import { describe, it, expect } from 'vitest';
import {
  assertUniqueIds,
  buildSearchText,
  extractSummary,
  KbParseError,
  parseDocument,
  parseFrontmatter,
  type KbDocument,
  type KbFrontmatter,
} from '../src/services/kb/parse.js';
import { KB_DOCUMENTS, KB_BUILD } from '../src/kb/documents.generated.js';

const VALID = `---
id: SOP-999
title_en: Test Procedure
title_ar: إجراء تجريبي
category: documents
country: SA
version: "1.0"
owner: HR
keywords_en: test, sample
keywords_ar: اختبار, عينة
---

## Purpose
This is the first paragraph, which becomes the summary.

## Steps
1. Do the thing.
`;

describe('parseFrontmatter', () => {
  it('splits frontmatter from body', () => {
    const { frontmatter, body } = parseFrontmatter(VALID);
    expect(frontmatter.id).toBe('SOP-999');
    expect(frontmatter.title_ar).toBe('إجراء تجريبي');
    expect(body.startsWith('## Purpose')).toBe(true);
  });

  it('strips quotes from a quoted value', () => {
    expect(parseFrontmatter(VALID).frontmatter.version).toBe('1.0');
  });

  it('handles CRLF line endings', () => {
    const { frontmatter } = parseFrontmatter(VALID.replace(/\n/g, '\r\n'));
    expect(frontmatter.id).toBe('SOP-999');
  });

  it('rejects a file with no frontmatter', () => {
    expect(() => parseFrontmatter('# Just a heading', 'x.md')).toThrow(KbParseError);
    expect(() => parseFrontmatter('# Just a heading', 'x.md')).toThrow(/missing opening/);
  });

  it('rejects unterminated frontmatter', () => {
    expect(() => parseFrontmatter('---\nid: X\n', 'x.md')).toThrow(/missing closing/);
  });

  it('rejects a malformed frontmatter line', () => {
    expect(() => parseFrontmatter('---\nid: X\nnonsense\n---\nbody', 'x.md')).toThrow(
      /not "key: value"/,
    );
  });

  it('names the offending file in the error', () => {
    expect(() => parseFrontmatter('nope', 'kb/sops/bad.md')).toThrow(/kb\/sops\/bad\.md/);
  });
});

describe('extractSummary', () => {
  it('takes the first real paragraph, skipping headings', () => {
    expect(extractSummary('## Purpose\n\nThe actual text.\n\nMore.')).toBe('The actual text.');
  });

  it('skips tables', () => {
    expect(extractSummary('| a | b |\n\nReal text.')).toBe('Real text.');
  });

  it('strips bold markers and collapses whitespace', () => {
    expect(extractSummary('Some **bold**   text\nwrapped.')).toBe('Some bold text wrapped.');
  });

  it('truncates with an ellipsis', () => {
    const long = 'x'.repeat(500);
    const summary = extractSummary(long, 50);
    expect(summary).toHaveLength(50);
    expect(summary.endsWith('…')).toBe(true);
  });

  it('returns empty when there is no prose', () => {
    expect(extractSummary('## Only\n\n### Headings')).toBe('');
  });
});

describe('buildSearchText — the bilingual retrieval strategy', () => {
  const fm: KbFrontmatter = {
    id: 'SOP-1',
    title_en: 'Iqama Renewal',
    title_ar: 'تجديد الإقامة',
    category: 'immigration',
    country: 'SA',
    version: '1.0',
    owner: 'GR',
    keywords_en: 'residence permit, renew',
    keywords_ar: 'رخصة إقامة, تجديد',
  };

  it('contains both languages, so either can retrieve the document', () => {
    const text = buildSearchText(fm, 'Body text about renewals.');
    expect(text).toContain('Iqama Renewal');
    expect(text).toContain('تجديد الإقامة');
    expect(text).toContain('residence permit');
    expect(text).toContain('رخصة إقامة');
  });

  it('repeats the titles, so a title term outweighs the same term in the body', () => {
    const text = buildSearchText(fm, 'body');
    const occurrences = text.split('Iqama Renewal').length - 1;
    expect(occurrences).toBe(2);
  });

  it('expands the category into words', () => {
    const text = buildSearchText({ ...fm, category: 'employee-relations' }, 'body');
    expect(text).toContain('employee relations');
  });

  it('truncates a very long body so one document cannot dilute its own embedding', () => {
    const text = buildSearchText(fm, 'x'.repeat(10_000), 200);
    expect(text.length).toBeLessThan(1_000);
  });

  it('omits absent keyword fields rather than emitting blanks', () => {
    const text = buildSearchText(
      { ...fm, keywords_en: undefined, keywords_ar: undefined },
      'body',
    );
    expect(text).not.toMatch(/\n\s*\n/);
  });
});

describe('parseDocument', () => {
  it('produces a complete indexable document', () => {
    const doc = parseDocument(VALID, 'kb/sops/test.md', 'hr_sops');
    expect(doc.docId).toBe('SOP-999');
    expect(doc.title).toBe('Test Procedure');
    expect(doc.titleAr).toBe('إجراء تجريبي');
    expect(doc.collection).toBe('hr_sops');
    expect(doc.summary).toContain('first paragraph');
    expect(doc.searchText).toContain('إجراء تجريبي');
  });

  it('rejects a missing required field', () => {
    const missing = VALID.replace('owner: HR\n', '');
    expect(() => parseDocument(missing, 'x.md', 'hr_sops')).toThrow(/missing required field "owner"/);
  });

  it('rejects an unknown country code', () => {
    const bad = VALID.replace('country: SA', 'country: QA');
    expect(() => parseDocument(bad, 'x.md', 'hr_sops')).toThrow(/country must be one of/);
  });

  it('accepts ALL as a country', () => {
    const all = VALID.replace('country: SA', 'country: ALL');
    expect(parseDocument(all, 'x.md', 'hr_sops').country).toBe('ALL');
  });

  it('defaults verified to false when the flag is absent', () => {
    expect(parseDocument(VALID, 'x.md', 'hr_sops').verified).toBe(false);
  });

  it('reads an explicit verified flag', () => {
    const v = VALID.replace('owner: HR', 'owner: HR\nverified: true');
    expect(parseDocument(v, 'x.md', 'hr_sops').verified).toBe(true);
  });
});

describe('assertUniqueIds', () => {
  const doc = (docId: string, sourcePath: string): KbDocument =>
    ({ docId, sourcePath }) as KbDocument;

  it('accepts distinct ids', () => {
    expect(() => assertUniqueIds([doc('A', 'a.md'), doc('B', 'b.md')])).not.toThrow();
  });

  it('rejects a duplicate id, naming both files', () => {
    expect(() => assertUniqueIds([doc('A', 'a.md'), doc('A', 'b.md')])).toThrow(
      /Duplicate knowledge-base id "A" in b\.md and a\.md/,
    );
  });
});

/**
 * These run against the real compiled corpus. They are the tests that would
 * catch someone adding a document that cannot be found in Arabic, or breaking
 * the build by editing markdown without regenerating.
 */
describe('the compiled knowledge base', () => {
  const arabicScript = /[ؠ-ي]/;

  it('compiled a useful number of documents', () => {
    expect(KB_DOCUMENTS.length).toBe(KB_BUILD.documentCount);
    expect(KB_DOCUMENTS.length).toBeGreaterThanOrEqual(15);
  });

  it('covers both collections', () => {
    expect(KB_BUILD.sops).toBeGreaterThanOrEqual(8);
    expect(KB_BUILD.policies).toBeGreaterThanOrEqual(5);
  });

  it('has unique document ids', () => {
    expect(() => assertUniqueIds(KB_DOCUMENTS)).not.toThrow();
  });

  it('makes every document retrievable in Arabic', () => {
    for (const doc of KB_DOCUMENTS) {
      expect(arabicScript.test(doc.searchText), `${doc.docId} has no Arabic search text`).toBe(true);
      expect(arabicScript.test(doc.titleAr), `${doc.docId} has no Arabic title`).toBe(true);
    }
  });

  it('makes every document retrievable in English', () => {
    for (const doc of KB_DOCUMENTS) {
      expect(/[A-Za-z]{4,}/.test(doc.searchText), `${doc.docId}`).toBe(true);
    }
  });

  it('gives every document a summary and content', () => {
    for (const doc of KB_DOCUMENTS) {
      expect(doc.summary.length, `${doc.docId} summary`).toBeGreaterThan(20);
      expect(doc.content.length, `${doc.docId} content`).toBeGreaterThan(200);
    }
  });

  it('uses only valid country codes', () => {
    for (const doc of KB_DOCUMENTS) {
      expect(['SA', 'AE', 'EG', 'JO', 'ALL']).toContain(doc.country);
    }
  });

  it('covers every operating country in the policy set', () => {
    const covered = new Set(
      KB_DOCUMENTS.filter((d) => d.collection === 'hr_policies').map((d) => d.country),
    );
    for (const c of ['SA', 'AE', 'EG', 'JO']) {
      expect(covered, `no policy document for ${c}`).toContain(c);
    }
  });

  it('documents the topics the brief calls out by name', () => {
    const haystack = KB_DOCUMENTS.map((d) => `${d.title} ${d.searchText}`).join(' ').toLowerCase();
    for (const topic of ['iqama', 'nitaqat', 'transfer', 'salary certificate', 'exit', 'housing allowance']) {
      expect(haystack, `no document mentions ${topic}`).toContain(topic);
    }
  });

  it('carries a citation on the policy documents that state legal figures', () => {
    const countryPolicies = KB_DOCUMENTS.filter(
      (d) => d.collection === 'hr_policies' && d.country !== 'ALL' && d.verified,
    );
    expect(countryPolicies.length).toBeGreaterThanOrEqual(4);
    for (const doc of countryPolicies) {
      expect(doc.citation, `${doc.docId} has no citation`).toBeTruthy();
    }
  });
});
