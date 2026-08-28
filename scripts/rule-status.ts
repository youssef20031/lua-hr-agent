/** Prints the provenance status of every statutory rule row. */
import { GRATUITY_RULES } from '../src/domain/rules/gratuity.js';
import { LEAVE_RULES, SICK_LEAVE_RULES, PROBATION_RULES } from '../src/domain/rules/leave.js';

type Row = { country: string; rule: string; verified: boolean; note: string };
const rows: Row[] = [];

for (const [c, r] of Object.entries(GRATUITY_RULES)) {
  rows.push({
    country: c,
    rule: 'gratuity',
    verified: r.verified,
    note: r.hasStatutoryGratuity ? 'accrues per year' : 'NO statutory gratuity',
  });
}
for (const [c, byType] of Object.entries(LEAVE_RULES)) {
  for (const [t, r] of Object.entries(byType)) {
    rows.push({ country: c, rule: `leave:${t}`, verified: r!.verified, note: r!.dayBasis });
  }
}
for (const [c, r] of Object.entries(SICK_LEAVE_RULES)) {
  rows.push({ country: c, rule: 'sick', verified: r.verified, note: `${r.tiers.length} tiers` });
}
for (const [c, r] of Object.entries(PROBATION_RULES)) {
  rows.push({ country: c, rule: 'probation', verified: r.verified, note: `${r.maxDays}d` });
}

console.log('country  rule             verified  note');
console.log('-------  ---------------  --------  ----');
for (const r of rows) {
  console.log(
    r.country.padEnd(8),
    r.rule.padEnd(16),
    (r.verified ? 'YES' : '-- NO').padEnd(9),
    r.note,
  );
}
const ok = rows.filter((r) => r.verified).length;
console.log(`\nverified ${ok} of ${rows.length} rule rows`);
if (ok < rows.length) {
  console.log('unverified:', rows.filter((r) => !r.verified).map((r) => `${r.country}/${r.rule}`).join(', '));
}
