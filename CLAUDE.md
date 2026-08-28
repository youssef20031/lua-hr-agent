# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install
npm run check          # typecheck + kb freshness + 270 tests + smoke — run this before any push
npm test               # vitest run
npm run typecheck      # tsc --noEmit
npm run kb:build       # recompile src/kb/documents.generated.ts from kb/*.md
npm run kb:check       # fail if the generated KB is stale (part of `check`)
npm run rules:status   # provenance table: which statutory rule rows are verified
npm run smoke          # end-to-end run against fixture backends, no accounts needed
```

Single test file / single test:

```bash
npx vitest run tests/gratuity.test.ts
npx vitest run -t "pays nothing below two years"
```

Deploying to the Lua platform (see `docs/RUNBOOK-lua.md`):

```bash
lua push      # stage
lua chat -e sandbox -t dev --clear -m "..."   # exercise the whole agent
lua test skill --name calculate_gratuity --input '{...}'   # one tool, no model
lua deploy    # promote staged build to production
lua logs --type skill --limit 20
```

`lua.skill.yaml` is CLI-managed — do not hand-edit it. Production env vars go on the server via
`lua env`, not in `.env`.

## Architecture

`src/index.ts` composes one `LuaAgent` from four `LuaSkill`s, two `LuaJob`s, one pre- and one
postprocessor. Everything below it is layered so that the platform SDK (`lua-cli`) only appears in
`src/skills/`, `src/jobs/`, `src/processors/` and `src/index.ts`.

**Domain is pure and country-agnostic.** `src/domain/` (gratuity, entitlement, iqama, date) contains
no country branching whatsoever. Jurisdictional differences live as data in `src/domain/rules/`,
normalised so one engine serves all four countries — e.g. gratuity accrual is expressed as *days of
wage per year of service*, which makes KSA's "half a month per year" and the UAE's "21 days" the
same code path with different numbers. Adding a country is a table edit.

**Every rule row carries provenance.** Each row in `src/domain/rules/` has `citation`, `sourceUrl`,
`lastReviewed` and `verified`. Anything derived from `verified: false` gets a bilingual `warning`
attached, which flows through the tool result and the persona instructs the model to pass on.
`npm run rules:status` prints the current state (14 of 18 verified; four Saudi rows are known
unverified). The warning mechanism is tested with a **synthetic** unverified rule, not a real one —
do not re-point those tests at whichever country happens to be unverified today.

**Both integrations sit behind interfaces with two implementations.** `HrisClient`
(`src/services/bamboohr/`) and `OpsSheetClient` (`src/services/sheets/`) each have `http.ts` and
`fixture.ts`, selected by `HRIS_MODE` / `SHEETS_MODE` in the factory `index.ts`. Tools call
`getHris()` / `getOpsSheet()` and never learn which they got. Fixtures are working implementations
(they compute entitlements from the same rule tables, enforce the same authorisation, mutate state),
not canned responses. A misconfigured `live` **degrades to fixture and reports it** through
`check_system_health` rather than throwing at import time. Both factories cache a process-wide
singleton and export a `resetHris()` / `resetOpsSheet()` test seam.

**The knowledge base is compiled, not read.** The Lua tool runtime executes a bundle, not a
checkout, so it cannot read `kb/*.md` at runtime. `scripts/build-kb.ts` parses the markdown
frontmatter into `src/kb/documents.generated.ts`, which ships with the agent; the
`reindex_knowledge_base` tool pushes those documents into Lua's vector store (`Data.create` /
`Data.update`, idempotent by `docId`).

**Bilingual handling is three deterministic pieces, the rest left to the model.** Detection
(`languageDetect.pre.ts` → persisted on the user record, because a 06:00 cron alert has no inbound
text to infer from), retrieval (each KB document's `searchText` contains both languages, so one
collection serves both), and presentation (tool results carry `{ en, ar }` pairs; `pick()` chooses
at the edge). `channelShape.post.ts` flattens component blocks, markdown tables and `**bold**` for
WhatsApp and leaves web replies untouched.

## Invariants worth knowing before editing

- **Edit anything under `kb/` → run `npm run kb:build` and commit the result.** `npm run kb:check`
  (in `check`) fails otherwise. Never hand-edit `src/kb/documents.generated.ts`.
- **A new KB document needs both `title_ar` and `keywords_ar`.** `kb:build` warns when a document has
  no Arabic in its search text; such a document is silently unreachable by Arabic queries.
- **Authorisation belongs in the adapter, not the tool.** `setLeaveRequestStatus` checks the actor is
  the line manager or HR *inside* `HrisClient`, so a job or a future tool cannot route around it.
- **Skill and tool `condition()` are fail-closed.** If the check throws, the tool is hidden rather
  than erroring — so a broken `currentEmployee()` lookup makes HR tools vanish silently instead of
  failing loudly. `hrOpsSkill` is gated at the skill level, so its context stays out of the prompt.
- **`User.get()` can return null.** Every tool handles it and returns a message; new ones must too.
- **`Data.search` and `Data.get` return different shapes.** `search` gives a flat proxied array
  (`r.title`); `get` gives an envelope (`r.data[i].data.title`). `toDoc()` in `knowledgeTools.ts`
  normalises the former.
- **All Sheets writes use `RAW`, never `USER_ENTERED`** — the latter turns employee code `01234` into
  `1234` and `+9665…` into a number. Tab titles and column headers live once, in
  `src/services/sheets/types.ts` (`TABS`, `HEADERS`), so fixture and live cannot drift.
- **Numbers, dates and reference codes stay in Western Arabic numerals in both languages** — that is
  what payslips and government documents in the region use.
- **Tests and the smoke run pin a reference date** (`2026-08-28`). Fixtures accept `referenceDate` /
  `now` injection; do not reach for real `Date.now()` in tests.
- **A new tool** goes in `src/skills/tools/*.ts` and must be added to that skill's `tools` array; a
  new skill must be registered in `src/index.ts`.
- **Skill `context` is the highest-leverage text in the repo.** When a tool works under `lua test`
  but the agent never calls it, fix the `context`, not the tool.
- `zod` arrives transitively via `lua-cli` and is not a direct dependency. Relative imports use
  explicit `.js` extensions throughout (ESM). `noUncheckedIndexedAccess` is on, so array/record
  indexing yields `| undefined`.
- Comments in this codebase explain *why*, often at length, and record the surprise that motivated
  the code. Match that when editing.

## Further reading

- `README.md` — what the system does, channel differences, known limitations.
- `docs/DECISIONS.md` — why each design choice was made, what turned out wrong, and the silent bugs
  the tests caught. Read this before revisiting a design decision.
- `docs/RUNBOOK-{lua,bamboohr,sheets,channels}.md` — going live, per integration.
- `.env.example` — every environment variable, with the failure mode each one causes.
