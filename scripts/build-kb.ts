/**
 * Compiles the markdown knowledge base into a TypeScript module.
 *
 * Why this exists: the Lua tool runtime executes a bundle, not a checkout. It
 * cannot read `kb/*.md` off disk at runtime. So the markdown — which is what a
 * human should author and review — is compiled into a generated module that
 * gets bundled with the agent, and the reindex tool reads that.
 *
 *   npm run kb:build     regenerate src/kb/documents.generated.ts
 *   npm run kb:check     verify the generated module is up to date (CI)
 *
 * Run it after editing anything under kb/.
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { assertUniqueIds, parseDocument, type KbDocument } from '../src/services/kb/parse.js';

const ROOT = resolve(process.cwd());
const OUT_PATH = join(ROOT, 'src', 'kb', 'documents.generated.ts');

const SOURCES: Array<{ dir: string; collection: 'hr_sops' | 'hr_policies' }> = [
  { dir: join(ROOT, 'kb', 'sops'), collection: 'hr_sops' },
  { dir: join(ROOT, 'kb', 'policies'), collection: 'hr_policies' },
];

function loadAll(): KbDocument[] {
  const docs: KbDocument[] = [];
  for (const { dir, collection } of SOURCES) {
    if (!existsSync(dir)) {
      throw new Error(`Knowledge-base directory not found: ${dir}`);
    }
    const files = readdirSync(dir)
      .filter((f) => f.endsWith('.md'))
      .sort();
    if (files.length === 0) {
      throw new Error(`No markdown documents found in ${dir}`);
    }
    for (const file of files) {
      const path = join(dir, file);
      docs.push(parseDocument(readFileSync(path, 'utf8'), `kb/${collection === 'hr_sops' ? 'sops' : 'policies'}/${file}`, collection));
    }
  }
  assertUniqueIds(docs);
  return docs;
}

function render(docs: KbDocument[]): string {
  const header = `/**
 * GENERATED FILE — DO NOT EDIT.
 *
 * Produced by \`npm run kb:build\` from the markdown under kb/.
 * Edit the markdown and regenerate; edits here will be overwritten.
 *
 * ${docs.length} documents: ${docs.filter((d) => d.collection === 'hr_sops').length} SOPs, ${docs.filter((d) => d.collection === 'hr_policies').length} policies.
 */
import type { KbDocument } from '../services/kb/parse.js';

export const KB_DOCUMENTS: KbDocument[] = ${JSON.stringify(docs, null, 2)};

export const KB_BUILD = {
  documentCount: ${docs.length},
  sops: ${docs.filter((d) => d.collection === 'hr_sops').length},
  policies: ${docs.filter((d) => d.collection === 'hr_policies').length},
} as const;
`;
  return header;
}

function main(): void {
  const check = process.argv.includes('--check');
  const docs = loadAll();
  const rendered = render(docs);

  if (check) {
    const existing = existsSync(OUT_PATH) ? readFileSync(OUT_PATH, 'utf8') : '';
    if (existing !== rendered) {
      console.error(
        'Generated knowledge base is out of date. Run "npm run kb:build" and commit the result.',
      );
      process.exit(1);
    }
    console.log(`Knowledge base is up to date (${docs.length} documents).`);
    return;
  }

  mkdirSync(join(ROOT, 'src', 'kb'), { recursive: true });
  writeFileSync(OUT_PATH, rendered, 'utf8');

  console.log(`Compiled ${docs.length} knowledge-base documents to src/kb/documents.generated.ts`);
  for (const doc of docs) {
    const flag = doc.verified ? '' : '  (no verified flag)';
    console.log(
      `  ${doc.docId.padEnd(12)} ${doc.collection === 'hr_sops' ? 'SOP   ' : 'POLICY'} ${doc.country.padEnd(4)} ${doc.title}${flag}`,
    );
  }

  // A document whose search text is missing one language will never be found
  // by a query in that language, which is a silent failure at query time.
  const arabicScript = /[ؠ-ي]/;
  const missingArabic = docs.filter((d) => !arabicScript.test(d.searchText));
  if (missingArabic.length > 0) {
    console.warn(
      `\nWARNING: ${missingArabic.length} document(s) have no Arabic in their search text and ` +
        `will not be retrievable by an Arabic query:\n  ${missingArabic.map((d) => d.docId).join(', ')}`,
    );
  }
}

main();
