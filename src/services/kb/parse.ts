/**
 * Knowledge-base document parsing and search-text construction.
 *
 * Pure functions with no filesystem or platform access, so the parsing and —
 * more importantly — the bilingual search-text strategy can be unit-tested.
 *
 * WHY THE SEARCH TEXT MATTERS
 * ---------------------------
 * Lua's `Data.search` embeds one string per entry and matches queries against
 * it. If that string is English, an Arabic question will not retrieve the
 * document. Rather than translating at query time, every document contributes
 * BOTH its English and Arabic titles, keywords and body to a single search
 * string. The embedding then sits in a space where "how do I renew my Iqama"
 * and "كيف أجدد الإقامة" both land near the same document, and one collection
 * serves both languages.
 */

export interface KbFrontmatter {
  id: string;
  title_en: string;
  title_ar: string;
  category: string;
  country: string;
  version: string;
  owner: string;
  keywords_en?: string;
  keywords_ar?: string;
  citation?: string;
  verified?: boolean;
}

export interface KbDocument {
  docId: string;
  title: string;
  titleAr: string;
  category: string;
  /** 'SA' | 'AE' | 'EG' | 'JO' | 'ALL' */
  country: string;
  version: string;
  owner: string;
  citation?: string;
  verified: boolean;
  /** Which collection this belongs in. */
  collection: 'hr_sops' | 'hr_policies';
  /** First substantive paragraph, used for previews. */
  summary: string;
  /** Full markdown body, minus the frontmatter. */
  content: string;
  /** The bilingual string handed to the vector store. */
  searchText: string;
  /** Source path, for diagnostics. */
  sourcePath: string;
}

export class KbParseError extends Error {
  constructor(
    message: string,
    readonly path: string,
  ) {
    super(`${path}: ${message}`);
    this.name = 'KbParseError';
  }
}

const REQUIRED_FIELDS: Array<keyof KbFrontmatter> = [
  'id',
  'title_en',
  'title_ar',
  'category',
  'country',
  'version',
  'owner',
];

/**
 * Minimal YAML frontmatter reader.
 *
 * Deliberately not a YAML library: the frontmatter here is flat key-value pairs
 * and pulling in a parser to read them would add a dependency to the bundle for
 * no benefit. It handles quoted values and rejects anything it does not
 * understand rather than guessing.
 */
export function parseFrontmatter(raw: string, path = '<inline>'): {
  frontmatter: Record<string, string>;
  body: string;
} {
  const normalised = raw.replace(/\r\n/g, '\n');
  if (!normalised.startsWith('---\n')) {
    throw new KbParseError('missing opening frontmatter delimiter "---"', path);
  }

  const end = normalised.indexOf('\n---\n', 4);
  if (end === -1) {
    throw new KbParseError('missing closing frontmatter delimiter "---"', path);
  }

  const block = normalised.slice(4, end);
  const body = normalised.slice(end + 5).trim();
  const frontmatter: Record<string, string> = {};

  for (const line of block.split('\n')) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const colon = line.indexOf(':');
    if (colon === -1) {
      throw new KbParseError(`frontmatter line is not "key: value": ${line}`, path);
    }
    const key = line.slice(0, colon).trim();
    let value = line.slice(colon + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
      (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    ) {
      value = value.slice(1, -1);
    }
    frontmatter[key] = value;
  }

  return { frontmatter, body };
}

/**
 * First substantive paragraph of the body.
 *
 * Headings are stripped from the FRONT of a block rather than causing the whole
 * block to be skipped. Markdown authors routinely write a heading and its prose
 * with no blank line between them, and treating that as "heading only" leaves
 * the document with no summary at all.
 */
export function extractSummary(body: string, maxLength = 320): string {
  for (const block of body.split(/\n\s*\n/)) {
    // Drop leading heading lines, then see what prose is left underneath.
    const remaining = block
      .split('\n')
      .filter((line) => !/^\s*#{1,6}\s/.test(line))
      .join('\n')
      .trim();

    // Tables, horizontal rules and bare lists do not read as a summary sentence.
    if (!remaining || remaining.startsWith('|') || /^-{3,}$/.test(remaining)) continue;

    const flat = remaining.replace(/\s+/g, ' ').replace(/\*\*/g, '');
    return flat.length > maxLength ? `${flat.slice(0, maxLength - 1).trimEnd()}…` : flat;
  }
  return '';
}

/**
 * Builds the bilingual search string.
 *
 * Titles and keywords are weighted by repetition — a term appearing in the
 * title should pull harder than the same term buried in the body — and the body
 * is truncated so one very long document cannot dilute its own embedding.
 */
export function buildSearchText(
  frontmatter: KbFrontmatter,
  body: string,
  bodyBudget = 1200,
): string {
  const parts: string[] = [
    // Titles twice: they are the strongest signal of what a document is about.
    frontmatter.title_en,
    frontmatter.title_en,
    frontmatter.title_ar,
    frontmatter.title_ar,
    frontmatter.keywords_en ?? '',
    frontmatter.keywords_ar ?? '',
    frontmatter.category.replace(/-/g, ' '),
    frontmatter.country === 'ALL' ? 'all countries' : frontmatter.country,
    body.slice(0, bodyBudget),
  ];

  return parts
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .join(' \n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/** Turns one raw markdown file into an indexable document. */
export function parseDocument(
  raw: string,
  sourcePath: string,
  collection: 'hr_sops' | 'hr_policies',
): KbDocument {
  const { frontmatter, body } = parseFrontmatter(raw, sourcePath);

  for (const field of REQUIRED_FIELDS) {
    if (!frontmatter[field]) {
      throw new KbParseError(`frontmatter is missing required field "${field}"`, sourcePath);
    }
  }

  const fm = frontmatter as unknown as KbFrontmatter;

  if (!/^(SA|AE|EG|JO|ALL)$/.test(fm.country)) {
    throw new KbParseError(
      `country must be one of SA, AE, EG, JO, ALL — got "${fm.country}"`,
      sourcePath,
    );
  }

  return {
    docId: fm.id,
    title: fm.title_en,
    titleAr: fm.title_ar,
    category: fm.category,
    country: fm.country,
    version: fm.version,
    owner: fm.owner,
    ...(fm.citation ? { citation: fm.citation } : {}),
    verified: String(frontmatter.verified) === 'true',
    collection,
    summary: extractSummary(body),
    content: body,
    searchText: buildSearchText(fm, body),
    sourcePath,
  };
}

/** Rejects a document set with duplicate ids, which would silently shadow entries. */
export function assertUniqueIds(docs: KbDocument[]): void {
  const seen = new Map<string, string>();
  for (const doc of docs) {
    const previous = seen.get(doc.docId);
    if (previous) {
      throw new Error(
        `Duplicate knowledge-base id "${doc.docId}" in ${doc.sourcePath} and ${previous}.`,
      );
    }
    seen.set(doc.docId, doc.sourcePath);
  }
}
