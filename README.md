# Rafiq — HR agent on Lua

A bilingual HR agent for a 50,000-employee industrial group headquartered in Riyadh, with
operations in Saudi Arabia, the UAE, Egypt and Jordan. Built on [Lua](https://heylua.ai) with
BambooHR as the HRIS and Google Sheets as the HR Ops control sheet.

Two of the four workflows in the brief are implemented: **leave management** and **SOP requests**.
Gratuity calculation, residency-permit alerting and Arabic/English handling run across both.

---

## Run it in two minutes, with no accounts

Both integrations default to local fixture stores. Nothing below needs a Lua, BambooHR or Google
account.

```bash
npm install
npm run check        # typecheck + knowledge-base freshness + 270 tests
```

Useful on their own:

```bash
npm run rules:status # provenance of every statutory rule row
npm run kb:build     # recompile the knowledge base from kb/*.md
npm test             # tests only
```

---

## What it does

**Leave management.** An employee asks for leave in Arabic or English. The agent reads their real
balance from BambooHR, applies the statutory entitlement for their country and length of service,
validates the dates, files the request, and routes it to their line manager. The manager approves in
chat; the employee is notified on their own channel in their own language.

**SOP requests.** An employee asks how to do something — a salary certificate, an exit and re-entry
visa, a transfer. The agent retrieves the procedure from a vector-indexed knowledge base. When
nothing covers the question it says so, logs the gap to Google Sheets, notifies HR, and hands the
employee a reference number. It does not invent a procedure.

**Gratuity.** End-of-service calculated with a step-by-step breakdown and the legal citation, for
whichever of the four countries applies.

**Residency permits.** A daily job sweeps Iqama and Emirates ID expiry, refreshes the HR watchlist in
Google Sheets, and proactively messages employees at 90, 60, 30 and 7 days.

**Two channels.** A web portal for office staff and WhatsApp for field workers — with genuinely
different behaviour, not the same output twice.

**Account linking.** WhatsApp identifies the sender by phone number; the web widget passes no
identity at all, so a portal visitor is anonymous and anything personal is refused. Rather than
accept a name typed into the chat, the agent sends a one-time code to the phone or email already on
that employee's record. You prove you control a channel the employer already knows, and only then
does the portal know you.

---

## How it is put together

```
  Web portal (LuaPop)          WhatsApp
        └───────────┬───────────────┘
                    ▼
        LuaAgent "Rafiq"
        preprocessor  → detect language, remember it
        postprocessor → reshape for the channel
                    ▼
   ┌────────────┬────────────┬──────────────┬──────────────┐
   │ leave-     │ hr-        │ hr-          │ hr-ops-      │  4 skills
   │ management │ knowledge  │ calculations │ dashboard    │
   └─────┬──────┴─────┬──────┴──────┬───────┴──────┬───────┘
         ▼            ▼             ▼              ▼
   BambooHR      Data API      domain/rules   Google Sheets
   adapter       (vector KB)   (pure TS)      adapter
         │                                       ▲
         └──── jobs: iqama-expiry-sweep ─────────┘
                     leave-audit-sync
```

Three decisions shape everything else.

**Every jurisdictional difference is data, not code.** `src/domain/` contains no country branching
at all. "Half a month per year" (Saudi Arabia) and "21 days per year" (UAE) are the same code path
expressed as days-of-wage-per-year in a rule table. Adding a fifth country is a data change.

**Every rule row carries its own provenance.** Each row has a `citation`, a `sourceUrl` and a
`verified` flag. Anything derived from an unverified row gets a visible warning attached, in both
languages, and the agent is instructed to pass it on. `npm run rules:status` prints the current
state. That mechanism is itself tested — with a *synthetic* unverified rule, so the tests keep
working as real rows get verified.

**Both integrations sit behind interfaces.** `HrisClient` and `OpsSheetClient` each have a real HTTP
implementation and a fixture implementation, chosen by an environment variable. Tools depend on the
interface and never learn which they got. A misconfigured `live` degrades to fixture rather than
throwing, and says so through `check_system_health` rather than pretending.

```
src/
  domain/        pure TypeScript: gratuity, entitlement, Iqama, date maths
    rules/       the statutory tables, with citations
  services/
    bamboohr/    HrisClient: types, http, fixture, factory
    sheets/      OpsSheetClient + dependency-free Google service-account auth
    kb/          knowledge-base parsing and bilingual search-text construction
    i18n.ts      language detection and bilingual formatting
  skills/        four LuaSkills and their tools
  jobs/          two cron jobs
  processors/    language detection (pre), channel reshaping (post)
  kb/            generated: the compiled knowledge base
kb/              the knowledge base as authored markdown, bilingual
fixtures/        the seed HRIS population
portal/          the static web portal
```

---

## The bilingual approach

Three things are handled deterministically rather than left to the model.

**Detection.** A preprocessor detects Arabic by Unicode script and persists the preference on the
user record. This matters for messages sent *outside* a conversation: when the sweep job fires at
06:00 there is no inbound text to infer a language from, and a field worker who has only ever written
in Arabic should not get an English alert about their residency permit.

**Retrieval.** Every knowledge-base document is indexed with a search string containing *both* its
English and Arabic titles, keywords and body. An Arabic question therefore retrieves the English
document and vice versa, from one collection, with no translation at query time. A build-time check
fails loudly if any document would be unreachable in either language.

**Presentation.** Tool results carry `{ en, ar }` pairs rather than pre-rendered strings, so the
choice is made at the edge. Numbers stay in Western Arabic numerals in both languages, because that
is what payslips and government documents in the region use.

---

## Channel differences

`Lua.request.channel` gives the live channel inside every tool, and the postprocessor uses it:

| | Web portal | WhatsApp |
| --- | --- | --- |
| Rich `::: component :::` blocks | rendered | flattened to plain lines |
| Markdown tables | rendered | flattened to `Label: value` lines |
| `**bold**` | as-is | converted to WhatsApp's `*bold*` |
| Length | fuller | short and scannable |

Markdown tables are the important case: they rely on monospace alignment WhatsApp does not have, and
a broken table in a right-to-left message is genuinely unreadable.

---

## Going live

Everything runs on fixtures until you set the environment variables in `.env.example`. When you are
ready:

- **Lua** — `docs/RUNBOOK-lua.md`
- **BambooHR** — `docs/RUNBOOK-bamboohr.md`
- **Google Sheets** — `docs/RUNBOOK-sheets.md`
- **WhatsApp and the portal** — `docs/RUNBOOK-channels.md`

One scheduling note: leave the BambooHR tenant **last**. There is no self-serve trial any more —
`bamboohr.com/signup/` books a sales demo rather than provisioning an account — so getting one is a
conversation, not a signup form. The adapter pattern means nothing is blocked on it either way;
`docs/RUNBOOK-bamboohr.md` has the current routes and the licensing question that goes with them.

---

## Known limitations

Stated plainly, because they are design decisions rather than oversights.

- **Four Saudi rule rows are unverified**: emergency leave, Hajj leave, sick leave and probation.
  They are flagged in the table, the calculator warns on them, and `npm run rules:status` lists them.
  Saudi annual leave and end-of-service *are* verified.
- **BambooHR has no time-off webhooks.** A decision made inside BambooHR rather than through the
  agent can only be discovered by polling, which is what `leave-audit-sync` does nightly.
- **Egypt's rules come from a transcription of Law 14/2025**, corroborated by secondary sources but
  not from the Official Gazette PDF. Worth a spot-check before production.
- **BambooHR throttling changes on 14 September 2026** — `503` today, `429` after. The client treats
  both as throttling and honours `Retry-After`, so it straddles the change.
- **The leave-audit de-duplication is coarse.** It relies on the summary counts the sheet exposes
  rather than reading back every row, so a re-run inside the same window can duplicate an audit
  entry. A duplicate audit row is a smaller problem than a missing one, which is why it errs that
  way, but it should read the tab directly.
- **The web portal has no single sign-on.** LuaPop's documented `init` options carry no user, email
  or token, so the widget cannot tell the agent who is browsing. Account linking works around that
  with a one-time code to the contact details already on the record, which is a real possession
  check rather than a name typed into a chat box — but it is a workaround. A portal that
  authenticated the employee and handed the widget a signed identity would be better, and needs
  something Lua does not currently expose.
- **`listEmployeesWithPermits` re-reads every employee** because the BambooHR directory does not
  carry custom fields. Fine at fixture scale and for a demo; a real 50,000-employee tenant needs a
  custom report instead.
