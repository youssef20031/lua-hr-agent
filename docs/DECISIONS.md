# Decisions and surprises

The reasoning behind the choices that shaped this build, and the things that turned out differently
from what I assumed. The README says what the system does; this says why, and what I got wrong.

---

## 1. Which two workflows

**Leave management and SOP requests.**

The brief asks for two of four, but also demands BambooHR *and* Google Sheets *and* a knowledge base.
Leave management is the workflow that genuinely exercises an HRIS — balances, entitlement rules,
approval routing, notifications. SOP requests is the one that genuinely exercises a knowledge base,
including the failure path where nothing matches.

Together they give Google Sheets an honest role as an **HR Ops control sheet** — gap log, leave audit,
permit watchlist — rather than a dashboard bolted on to satisfy a requirement. And they map cleanly
onto the two audiences the brief names: office staff on the web, field workers on WhatsApp.

Onboarding was the tempting alternative, but it needs document collection over WhatsApp, which is
demo-fragile, and BambooHR's onboarding-checklist API coverage is thin.

## 2. Jurisdiction as data, not code

`src/domain/` contains no `if (country === 'SA')` anywhere.

Saudi Arabia's "half a month's wage per year" and the UAE's "21 days per year" look like different
rules until you express both as *days of wage per year of service*: 15 and 21. Then they are one
engine and a table. The payoff is not elegance — it is that the legal content is auditable on its
own, unit-testable in milliseconds, and reviewable by someone who does not read TypeScript
control flow.

## 3. Provenance on every rule row

Every rule carries `citation`, `sourceUrl`, `lastReviewed` and `verified`. Anything derived from an
unverified row gets a bilingual warning attached, which the agent is instructed to pass on.

This exists because the failure mode here is not a crash. It is an employee being told, confidently
and in their own language, that they are owed 44,000 riyals when they are not. A wrong number in a
gratuity calculator is the worst thing this system could ship, and it would ship silently.

`npm run rules:status` prints the current state: 14 of 18 rows verified.

**The safety net is tested with a synthetic unverified rule**, not with whichever country happens to
be unverified today. The first version used real rows and broke the moment three countries were
verified — a test that punishes you for improving the data is a bad test.

## 4. Adapters with fixtures, not mocks

`HrisClient` and `OpsSheetClient` each have a real HTTP implementation and a fixture implementation
behind an environment variable.

The fixtures are *working implementations*, not canned responses: the fixture HRIS computes
entitlements from the same rule tables, enforces the same overlap and authorisation rules, and
mutates state. The fixture sheet answers `readOpsSummary` from data it actually holds, through the
same summariser the live client uses, so the two cannot disagree about the numbers.

Three things fall out of this:

- A reviewer clones the repo and runs the whole thing with no accounts.
- Development never burned days of a 7-day BambooHR trial.
- A misconfigured `live` **degrades to fixture and says so** through `check_system_health`, rather
  than throwing at import time. An HR agent that cannot reach BambooHR should still answer policy
  questions.

## 5. Authorisation lives in the adapter

`setLeaveRequestStatus` checks the actor is the line manager or HR *inside the HRIS client*, not in
the tool. If it lived in the tool, a second caller — a job, a webhook, a future tool — could route
around it. There is one door.

## 6. Bilingual: three deterministic pieces, the rest to the model

The model handles replying in the language it was addressed in. Three things it cannot do reliably
are handled in code:

- **Detection and persistence.** When the Iqama sweep fires at 06:00 there is no inbound message to
  infer a language from. Without a stored preference, a field worker who has only ever written Arabic
  gets an English alert about their residency permit.
- **Retrieval.** Every knowledge-base document is indexed with English *and* Arabic titles, keywords
  and body in one search string, so an Arabic question retrieves an English document with no
  translation step. A build-time check fails if any document would be unreachable in either language.
- **Presentation.** Tool results carry `{ en, ar }` pairs so the choice happens at the edge.

Numbers stay in Western Arabic numerals in both languages. Arabic-Indic digits in a payslip figure
read as unusual in the Gulf, not as a courtesy.

## 7. The knowledge base is compiled, not read

The markdown under `kb/` is what a human authors and reviews. But the Lua tool runtime executes a
bundle, not a checkout, so it cannot read those files. `npm run kb:build` compiles them into a
generated module that ships with the agent, and `npm run kb:check` fails CI if someone edits the
markdown without regenerating.

---

## What surprised me

**BambooHR has no time-off webhooks.** A manager who approves leave inside BambooHR rather than
through the agent produces a decision the agent never sees. The only remedy is polling, which is why
`leave-audit-sync` exists. I would not have designed that job if I had not checked.

**Creating a time-off request is `PUT`, not `POST`.**

**BambooHR's throttling status code changes on 14 September 2026** — `503` today, `429` after, at
which point `503` means genuine unavailability only. A client written today straddles the change, so
it treats both as throttling.

**Egypt and Jordan have no Gulf-style gratuity.** This was the significant correction. I had modelled
both as accruing per year like Saudi Arabia. In fact Egypt's Article 172 provides a gratuity only
where social insurance does *not* apply, and Jordan's Article 32 carves out anyone covered by the
Social Security Corporation — which is compulsory at any employer with one or more workers. Quoting
an accrued figure to those employees would have been actively harmful, so the domain model gained
`hasStatutoryGratuity` and the calculator now refuses to produce a number, explaining what governs
instead.

**Egypt is on a law I had not accounted for.** Law 14/2025 replaced 12/2003 on 1 September 2025.
First-year annual leave is 15 days, not 21.

**The UAE inverts the Saudi wage base.** Saudi Arabia computes on wage *including* allowances; the
UAE on *basic only*. Same-looking formula, materially different answers, and the easiest cross-border
mistake to make.

**Google's `USER_ENTERED` would have corrupted the data.** It turns employee code `01234` into
`1234` and `+9665...` into a number. All writes use `RAW`.

**Sheets quota is 60/minute, not 300.** The 300 is per project; the 60 is per user, and one service
account is one user.

---

## Bugs the tests caught

Worth recording, because each was silent.

- **Tenure arithmetic.** Subtracting day numbers and borrowing across months fails for anyone hired
  on the 29th, 30th or 31st — one borrow from a shorter month is not always enough. Replaced with
  clamped month arithmetic.
- **Language detection.** My Arabic character range included Arabic-Indic digits, so a bare year
  `٢٠٢٦` was detected as Arabic. Letters decide language; digits do not — and Latin digits were
  already excluded, so it was asymmetric as well as wrong.
- **Summary extraction.** Any block whose first line was a heading got skipped entirely, but the
  documents put prose directly under the heading with no blank line, so several had empty summaries.
- **An untranslated total.** The final gratuity line read `66,065.75 × 0.667 = 44,043.84 SAR` in
  both languages — no Arabic at all in the one line the employee actually reads. The unit test only
  checked the *label* was Arabic; the smoke run checked the *detail* and caught it. The unit test
  now checks both.

## Known limitations

Listed in the README, and deliberately not hidden: four unverified Saudi rows, coarse leave-audit
de-duplication, an `N+1` read in `listEmployeesWithPermits`, and Egypt's figures resting on a
transcription rather than the Official Gazette.
