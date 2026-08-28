# Demo script — 10 minutes

Rehearse this. The cap is hard, and the interesting part is at the end.

## Before recording

```bash
npm run check                   # green
npm run rules:status            # have this on screen for the provenance beat
```

Clear the HR Ops sheet by hand: delete any rows under **SOP Gaps** and **Leave Audit**, and the
empty default `Sheet1` tab. The sheet is live now, so the gap row has to land on camera rather than
sit there from a rehearsal.

Open: the portal at <https://youssef20031.github.io/lua-hr-agent/>, the agent console at
admin.heylua.ai, a WhatsApp thread linked to the agent, and the Google Sheet.

Check the agent is named **Rafiq** and not `test` in the dashboard — its name appears against every
reply in the console transcript.

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

## 2:45–4:15 — The portal, and what a web visitor can and cannot do

Open the portal. Both languages sit on screen at once and the toggle changes reading direction
rather than hiding one, which is how bilingual signage on a Saudi industrial site actually works.
Two doors: office staff into the chat, field staff into WhatsApp.

Ask the widget a **rule** question: *"How many annual leave days does Saudi law give after five
years?"* It answers 30, with Article 109, and renders the structure properly — this is the rich
channel.

Then ask it a **personal** question: *"How many days do I have left?"* It refuses: it cannot match
you to an employee record. Say why, because it is a design point rather than a bug. LuaPop passes no
user identity, so a web visitor is anonymous. Then type *"I am Ahmad"* — it still refuses. Identity
comes from the channel, never from a claim inside the conversation, or anyone could read anyone
else's balance by asserting a name.

That is what sends personal requests to WhatsApp, where the sender's number identifies them. The
split matches the two audiences in the brief rather than working around them.

## 4:15–6:45 — Leave and Arabic on WhatsApp, and a real gap

On WhatsApp: **كم يوم إجازة متبقي لي؟**

Now it knows who you are, from the sender's number. It answers in Arabic with the real balance —
short plain text, no tables, because the postprocessor reshaped it for the channel. Same question,
same agent, different channel, different answer: that contrast is the multi-channel requirement.

Then file one: *"I want to take annual leave from 10 to 15 March."* It reads the dates back and asks
to confirm — six days, inclusive — then files it and names the approver. Show the row landing in the
**Leave Audit** tab.

If WhatsApp is unavailable, run this beat in the agent console instead and say so; the console
resolves you by the email on your Lua account, so identity still works there.

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
