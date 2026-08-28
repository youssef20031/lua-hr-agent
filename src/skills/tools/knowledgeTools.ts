/**
 * SOP and policy knowledge-base tools.
 *
 * The second workflow from the brief: an employee asks for any HR standard
 * operating procedure, the agent retrieves it from a knowledge base, and if no
 * SOP covers the request it logs the gap and escalates to HR.
 *
 * Retrieval uses Lua's built-in vector store (`Data.search`). Documents are
 * indexed with a bilingual `searchText`, so an Arabic question retrieves an
 * English document and vice versa without any translation step at query time.
 */
import { z } from 'zod';
import type { LuaTool } from 'lua-cli';
import { Channels, Data, Lua, User } from 'lua-cli';

import { getOpsSheet } from '../../services/sheets/index.js';
import { KB_DOCUMENTS } from '../../kb/documents.generated.js';
import { getHris } from '../../services/bamboohr/index.js';
import { detectLanguage, t } from '../../services/i18n.js';
import { currentEmployee, currentLanguage } from './calculationTools.js';
import type { Language } from '../../domain/types.js';

export const COLLECTIONS = {
  sops: 'hr_sops',
  policies: 'hr_policies',
  gaps: 'sop_gaps',
} as const;

/**
 * Retrieval thresholds.
 *
 * `CONFIDENT` is what we will answer from directly. Between `CONFIDENT` and
 * `WEAK` we answer but hedge and offer escalation. Below `WEAK` we treat it as
 * a genuine gap. These numbers are the main tuning knob for the whole SOP
 * workflow, so they live here rather than being scattered as literals.
 */
export const CONFIDENT_SCORE = 0.62;
export const WEAK_SCORE = 0.45;

interface RetrievedDoc {
  id: string;
  title: string;
  titleAr: string;
  category: string;
  country: string;
  score: number;
  summary: string;
  content: string;
  version: string;
  owner: string;
}

/**
 * `Data.search` returns proxied entries whose fields sit directly on the object,
 * unlike `Data.get`, which wraps them in `.data`. Normalising here means one
 * place to fix if that ever changes.
 */
function toDoc(entry: Record<string, unknown>): RetrievedDoc {
  const s = (k: string): string => {
    const v = entry[k];
    return v === undefined || v === null ? '' : String(v);
  };
  return {
    id: s('docId') || s('id'),
    title: s('title'),
    titleAr: s('titleAr'),
    category: s('category'),
    country: s('country'),
    score: Number(entry.score ?? 0),
    summary: s('summary'),
    content: s('content'),
    version: s('version'),
    owner: s('owner'),
  };
}

async function searchCollection(
  collection: string,
  query: string,
  limit: number,
): Promise<RetrievedDoc[]> {
  // A low floor is passed to the store and the banding is applied here, so the
  // agent can see near-misses and decide to hedge rather than being handed an
  // empty list.
  const results = await Data.search(collection, query, limit, 0.25);
  return (results as unknown as Record<string, unknown>[]).map(toDoc);
}

export class SearchSopTool implements LuaTool {
  name = 'search_sop';
  description =
    'Search the HR standard operating procedures for how to do something: transfer requests, ' +
    'salary certificates, exit and re-entry visas, housing allowance, Iqama renewal, resignation, ' +
    'expense claims, grievances and so on. Works in Arabic or English. If nothing matches well ' +
    'enough, this reports a gap and you must then call log_sop_gap.';

  inputSchema = z.object({
    query: z
      .string()
      .min(2)
      .describe('The employee question, in their own words and their own language.'),
    country: z
      .string()
      .optional()
      .describe('Restrict to a country (SA, AE, EG, JO) when the question is clearly country-specific.'),
  });

  async execute(input: z.infer<typeof this.inputSchema>): Promise<unknown> {
    const language = await currentLanguage();
    const docs = await searchCollection(COLLECTIONS.sops, input.query, 5);

    const relevant = input.country
      ? docs.filter((d) => !d.country || d.country === input.country || d.country === 'ALL')
      : docs;

    const best = relevant[0];

    if (!best || best.score < WEAK_SCORE) {
      // The gap path. Explicitly instruct the next step rather than leaving the
      // model to invent an answer, which is exactly what we must not do here.
      return {
        ok: true,
        found: false,
        bestScore: best?.score ?? 0,
        nearestTitle: best?.title,
        instruction:
          'No SOP covers this. Tell the employee you do not have a documented procedure, then call ' +
          'log_sop_gap with their original question. Do not invent a procedure.',
        message:
          language === 'ar'
            ? 'لا يوجد إجراء موثق لهذا الطلب حالياً.'
            : 'There is no documented procedure for this yet.',
      };
    }

    return {
      ok: true,
      found: true,
      confident: best.score >= CONFIDENT_SCORE,
      results: relevant
        .filter((d) => d.score >= WEAK_SCORE)
        .map((d) => ({
          docId: d.id,
          title: language === 'ar' && d.titleAr ? d.titleAr : d.title,
          category: d.category,
          country: d.country,
          score: Number(d.score.toFixed(3)),
          summary: d.summary,
          content: d.content,
          version: d.version,
          owner: d.owner,
        })),
      instruction:
        best.score >= CONFIDENT_SCORE
          ? 'Answer from the top result. Cite the document title and version. Do not add steps that are not in it.'
          : 'The match is weak. Answer from it but say you are not certain it is the right procedure, and offer to log it for HR.',
    };
  }
}

export class SearchPolicyTool implements LuaTool {
  name = 'search_policy';
  description =
    'Search HR policy and labour-law reference material: annual and sick leave rules, probation, ' +
    'end-of-service, Nitaqat and Saudization, Iqama rules, and country-specific employment terms ' +
    'for Saudi Arabia, the UAE, Egypt and Jordan. Use for "what is the policy on..." and "what does ' +
    'the law say about..." questions. For a step-by-step procedure use search_sop instead.';

  inputSchema = z.object({
    query: z.string().min(2).describe('The policy question, in the employee\'s own language.'),
    country: z.string().optional().describe('Restrict to SA, AE, EG or JO.'),
  });

  async execute(input: z.infer<typeof this.inputSchema>): Promise<unknown> {
    const language = await currentLanguage();
    const docs = await searchCollection(COLLECTIONS.policies, input.query, 5);

    const relevant = input.country
      ? docs.filter((d) => !d.country || d.country === input.country || d.country === 'ALL')
      : docs;
    const usable = relevant.filter((d) => d.score >= WEAK_SCORE);

    if (usable.length === 0) {
      return {
        ok: true,
        found: false,
        bestScore: relevant[0]?.score ?? 0,
        instruction:
          'No policy document matches. Say so plainly and offer to log it for HR with log_sop_gap. ' +
          'Do not guess at a legal position.',
        message:
          language === 'ar'
            ? 'لا توجد سياسة موثقة تغطي هذا السؤال.'
            : 'No documented policy covers that question.',
      };
    }

    return {
      ok: true,
      found: true,
      confident: usable[0]!.score >= CONFIDENT_SCORE,
      results: usable.map((d) => ({
        docId: d.id,
        title: language === 'ar' && d.titleAr ? d.titleAr : d.title,
        category: d.category,
        country: d.country,
        score: Number(d.score.toFixed(3)),
        summary: d.summary,
        content: d.content,
        version: d.version,
      })),
      instruction:
        'Answer from these documents and cite the title. Where a document gives a legal article ' +
        'reference, include it. Never state a legal entitlement that is not in the retrieved text.',
    };
  }
}

export class LogSopGapTool implements LuaTool {
  name = 'log_sop_gap';
  description =
    'Record that the knowledge base could not answer an employee question, escalate it to HR, and ' +
    'give the employee a reference number. Call this whenever search_sop or search_policy reports ' +
    'found: false, or when the employee says the answer did not help.';

  inputSchema = z.object({
    question: z
      .string()
      .min(3)
      .describe('The employee original question, verbatim, in the language they asked it.'),
    bestMatchScore: z
      .number()
      .min(0)
      .max(1)
      .default(0)
      .describe('The best score the search returned, so HR can see how close it was.'),
    category: z
      .string()
      .optional()
      .describe('Rough topic, e.g. "visa", "payroll", "benefits", if you can tell.'),
  });

  async execute(input: z.infer<typeof this.inputSchema>): Promise<unknown> {
    const language = await currentLanguage();
    const employee = await currentEmployee();
    const channel = Lua.request.channel;
    const reference = makeReference();

    const questionLanguage: Language = detectLanguage(input.question) ?? language;

    const record = {
      reference,
      employeeId: employee?.id ?? 'unknown',
      employeeName: employee?.displayName ?? '',
      country: employee?.country ?? 'SA',
      channel,
      language: questionLanguage,
      question: input.question,
      category: input.category ?? '',
      bestMatchScore: input.bestMatchScore,
      status: 'open' as const,
      loggedAt: new Date().toISOString(),
    };

    // Two destinations: the agent's own collection, which makes gaps
    // searchable and de-duplicable, and the HR Ops sheet, which is what HR
    // actually looks at every morning.
    const failures: string[] = [];

    try {
      await Data.create(
        COLLECTIONS.gaps,
        record,
        `${input.question} ${input.category ?? ''} ${record.country}`,
      );
    } catch (error) {
      failures.push(`collection: ${error instanceof Error ? error.message : String(error)}`);
    }

    try {
      await getOpsSheet().appendSopGap({
        loggedAt: record.loggedAt,
        reference,
        employeeId: record.employeeId,
        country: record.country,
        channel,
        language: questionLanguage,
        question: input.question,
        bestMatchScore: input.bestMatchScore,
        status: 'open',
        assignedTo: 'hr-ops',
      });
    } catch (error) {
      failures.push(`sheet: ${error instanceof Error ? error.message : String(error)}`);
    }

    const notified = await notifyHr(record);

    return {
      ok: true,
      reference,
      hrNotified: notified,
      // Partial failure is reported, not swallowed: the employee still gets a
      // reference, but we do not claim HR has it if the write failed.
      partialFailures: failures.length > 0 ? failures : undefined,
      message:
        language === 'ar'
          ? `سجلت سؤالك لدى الموارد البشرية برقم مرجعي ${reference}، وسيتم التواصل معك.`
          : `I have logged this with HR under reference ${reference} and they will follow up.`,
      followUp: t('escalated', language),
    };
  }
}

/** HR-only view of what the knowledge base keeps failing to answer. */
export class ListSopGapsTool implements LuaTool {
  name = 'list_sop_gaps';
  description =
    'HR only. List recent knowledge-base gaps: questions employees asked that no SOP or policy ' +
    'could answer. Use when HR asks what documentation is missing or what people keep asking about.';

  inputSchema = z.object({
    windowDays: z.number().int().min(1).max(90).default(7).describe('How far back to look.'),
  });

  async condition(): Promise<boolean> {
    const me = await currentEmployee();
    return Boolean(me?.isHrStaff);
  }

  async execute(input: z.infer<typeof this.inputSchema>): Promise<unknown> {
    const summary = await getOpsSheet().readOpsSummary(input.windowDays);
    return {
      ok: true,
      windowDays: summary.windowDays,
      totalGaps: summary.sopGaps.total,
      openGaps: summary.sopGaps.open,
      topQuestions: summary.sopGaps.topQuestions,
      instruction:
        'Present the top questions as a prioritised list of SOPs worth writing, most-asked first.',
    };
  }
}

/* -------------------------------------------------------------------------- */

function makeReference(): string {
  const year = new Date().getUTCFullYear();
  // Short, unambiguous, and quotable over the phone.
  const suffix = Math.floor(Math.random() * 10_000)
    .toString()
    .padStart(4, '0');
  return `GAP-${year}-${suffix}`;
}

async function notifyHr(record: {
  reference: string;
  question: string;
  employeeName: string;
  country: string;
  channel: string;
}): Promise<boolean> {
  try {
    const hrStaff = (await getHris().listEmployees()).filter((e) => e.isHrStaff);
    if (hrStaff.length === 0) return false;

    const text =
      `Knowledge-base gap ${record.reference}\n` +
      `From: ${record.employeeName || 'unidentified employee'} (${record.country}, ${record.channel})\n` +
      `Question: ${record.question}\n` +
      `No SOP or policy covered this. Consider documenting it.`;

    let any = false;
    for (const person of hrStaff) {
      const user = await User.get({ email: person.workEmail });
      if (user) {
        await user.send([{ type: 'text', text }]);
        any = true;
      } else {
        const sent = await Channels.send({
          channel: 'email',
          to: { email: person.workEmail },
          text,
        });
        any ||= sent.delivered;
      }
    }
    return any;
  } catch {
    // HR notification is a convenience; the sheet row is the system of record.
    return false;
  }
}

/**
 * HR-only: pushes the compiled knowledge base into the vector store.
 *
 * The markdown under kb/ is compiled into a generated module by
 * `npm run kb:build`, because the tool runtime executes a bundle and cannot
 * read the repository off disk. This tool indexes that module.
 *
 * Indexing is idempotent by document id: an existing entry is updated rather
 * than duplicated, so running it twice does not double the corpus and quietly
 * halve every relevance score.
 */
export class ReindexKnowledgeBaseTool implements LuaTool {
  name = 'reindex_knowledge_base';
  description =
    'HR only. Load or refresh the SOP and policy knowledge base in the vector store from the ' +
    'documents shipped with the agent. Use after HR publishes or edits a procedure, or if search ' +
    'is returning nothing at all.';

  inputSchema = z.object({
    collection: z
      .enum(['all', 'hr_sops', 'hr_policies'])
      .default('all')
      .describe('Limit the reindex to one collection. Defaults to both.'),
  });

  async condition(): Promise<boolean> {
    const me = await currentEmployee();
    return Boolean(me?.isHrStaff);
  }

  async execute(input: z.infer<typeof this.inputSchema>): Promise<unknown> {
    const wanted =
      input.collection === 'all'
        ? KB_DOCUMENTS
        : KB_DOCUMENTS.filter((d) => d.collection === input.collection);

    let created = 0;
    let updated = 0;
    const failures: string[] = [];

    for (const doc of wanted) {
      const payload = {
        docId: doc.docId,
        title: doc.title,
        titleAr: doc.titleAr,
        category: doc.category,
        country: doc.country,
        version: doc.version,
        owner: doc.owner,
        citation: doc.citation ?? '',
        summary: doc.summary,
        content: doc.content,
      };

      try {
        // Look for an existing entry with this document id first, so a rebuild
        // replaces rather than duplicates.
        const existing = await Data.get(doc.collection, { docId: doc.docId }, 1, 1);
        const entryId = existing?.data?.[0]?.id as string | undefined;

        if (entryId) {
          await Data.update(doc.collection, entryId, payload, doc.searchText);
          updated += 1;
        } else {
          await Data.create(doc.collection, payload, doc.searchText);
          created += 1;
        }
      } catch (error) {
        failures.push(`${doc.docId}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    return {
      ok: failures.length === 0,
      requested: wanted.length,
      created,
      updated,
      failures: failures.length > 0 ? failures : undefined,
      message:
        failures.length === 0
          ? `Indexed ${wanted.length} documents: ${created} new, ${updated} refreshed.`
          : `Indexed ${created + updated} of ${wanted.length} documents; ${failures.length} failed.`,
    };
  }
}

export const knowledgeTools = [
  new SearchSopTool(),
  new SearchPolicyTool(),
  new LogSopGapTool(),
  new ListSopGapsTool(),
  new ReindexKnowledgeBaseTool(),
];
