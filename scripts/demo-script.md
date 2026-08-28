# Demo script — 10 minutes

Rehearse this. The cap is hard, and the interesting part is at the end.

## Before recording

```bash
rm -f .local/ops-sheet.json     # clean slate
npm run check                   # green
npm run rules:status            # have this on screen for the provenance beat
```

Open: the portal, a WhatsApp chat linked to the agent, and the Google Sheet.

---

## 0:00–1:00 — The problem

50,000 employees, four countries, zero HR technology. Everything today is manual, paper, or WhatsApp
messages between coordinators.

Two of the four workflows, chosen because together they cover every requirement: **leave
management** drives BambooHR, **SOP requests** drive the knowledge base, and both feed the Google
Sheet as a genuine HR Ops control sheet rather than a bolt-on.

## 1:00–2:45 — Architecture

Show the diagram in the README, then make three points and move on:

1. **Jurisdiction is data.** `src/domain/rules/` — Saudi "half a month per year" and UAE "21 days per
   year" are one code path. Adding a country is a data change.
2. **Every rule carries provenance.** Show `npm run rules:status`. 14 of 18 rows verified; the four
   that are not are flagged, and the calculator attaches a warning to anything derived from them.
3. **Integrations are interfaces.** One env var swaps BambooHR for a fixture. That is why this
   repository runs end to end on a fresh clone with no accounts.

## 2:45–5:00 — Leave, in English, on the web

In the portal: *"How many annual leave days do I have left?"*

Point out it resolved the employee, read the balance from the HRIS, and volunteered the step-up date.

Then: *"I want to take annual leave from 10 to 15 March."*

- It reads the dates back and asks to confirm — six days, inclusive.
- It files the request and names the approver.
- Switch to the manager: *"approve LR-6000"* — and the employee is notified.

Show the row landing in the **Leave Audit** tab.

## 5:00–6:45 — Arabic, on WhatsApp, and a real gap

On WhatsApp: **كم يوم إجازة متبقي لي؟**

It answers in Arabic. Point out the reply is short plain text with no tables — the postprocessor
reshaped it for the channel.

Then ask for something that genuinely is not documented:
*"What is the process for transferring my wife's visa to my sponsorship?"*

It says it has no documented procedure, logs the gap, and returns a reference. Show the row appear in
the **SOP Gaps** tab.

That refusal is the point. An HR agent that invents a visa procedure is worse than no agent.

## 6:45–8:30 — Gratuity and the Iqama sweep

*"What would my end of service be if I resign?"*

Walk the breakdown by its shape, not by a memorised total: daily wage 400 (12,000 ÷ 30), 15 days of
wage per year for the first five years, 30 days a year after that, then **two thirds** under Article
85 because this is a resignation between five and ten years. Show the citation.

**Read the total off the screen.** Ahmad's hire date is fixed at 2018-03-01 while the demo runs
against today, so his service — and the figure — grows every time you rehearse. It was 44,043.84 SAR
at exactly eight years; on 2026-08-29 it is **47,989.04 SAR** on a gross of 71,983.56. The unit tests
pin the eight-year figure with fixed dates, which is why the two differ. Quoting a stale number over
a live screen is the one way to make a correct calculator look broken.

Then the finding worth showing: ask the same for an Egyptian or Jordanian colleague. It returns **no
figure**, and explains that end of service there runs through social insurance. That was a real
correction during the build — both were originally modelled as accruing per year, which would have
told those employees they were owed money they are not.

Then trigger `iqama-expiry-sweep`: the watchlist tab refreshes, someone is expired, someone is at
seven days, and the alerts go out in each person's own language.

## 8:30–10:00 — What I would harden

- Roles come from BambooHR fields today; they should come from a real RBAC source.
- WhatsApp templates pre-approved for the four alert thresholds.
- `listEmployeesWithPermits` re-reads every employee — a 50,000-employee tenant needs a custom report.
- The four unverified Saudi rows closed out against primary sources.
- Observability: today `check_system_health` is the whole story.

Close on the fixture switch: `HRIS_MODE=fixture` is why anyone can clone this and see it work.
