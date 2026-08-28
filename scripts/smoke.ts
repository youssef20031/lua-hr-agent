/**
 * End-to-end smoke run against the fixture backends.
 *
 * Unit tests prove the pieces. This proves they compose: a real leave request
 * travelling from balance check to HRIS write to manager approval to an audit
 * row on the ops sheet, plus the gratuity and Iqama paths.
 *
 * It deliberately does NOT touch the Lua runtime, so it runs on a fresh clone
 * with no accounts and no credentials:
 *
 *   npm run smoke
 */
import { FixtureHrisClient } from '../src/services/bamboohr/fixture.js';
import { FixtureOpsSheetClient } from '../src/services/sheets/fixture.js';
import { calculateGratuity } from '../src/domain/gratuity.js';
import { CURRENCIES, gratuityRuleFor } from '../src/domain/rules/gratuity.js';
import { calculateEntitlement } from '../src/domain/entitlement.js';
import { leaveRuleFor } from '../src/domain/rules/leave.js';
import { checkIqamaExpiry, dueForAlert, sortByUrgency } from '../src/domain/iqama.js';
import { COUNTRIES, type CountryCode } from '../src/domain/types.js';
import { pick } from '../src/services/i18n.js';
import { KB_DOCUMENTS } from '../src/kb/documents.generated.js';

const REFERENCE = '2026-08-28';

const hris = new FixtureHrisClient({ referenceDate: REFERENCE });
const sheet = new FixtureOpsSheetClient({ persist: false, now: () => new Date(`${REFERENCE}T08:00:00Z`) });

let failures = 0;

function heading(text: string): void {
  console.log(`\n\x1b[1m${text}\x1b[0m`);
  console.log('-'.repeat(text.length));
}

function check(label: string, condition: boolean, detail = ''): void {
  if (condition) {
    console.log(`  ok    ${label}${detail ? ` — ${detail}` : ''}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

async function main(): Promise<void> {
  console.log(`Rafiq smoke run — fixture backends, reference date ${REFERENCE}`);

  /* ---------------------------------------------------------------- */
  heading('1. Backends');

  const hrisHealth = await hris.health();
  const sheetHealth = await sheet.health();
  check('HRIS reachable', hrisHealth.ok, `${hrisHealth.mode}, ${hrisHealth.employeeCount} employees`);
  check('Ops sheet reachable', sheetHealth.ok, sheetHealth.mode);
  check('Knowledge base compiled', KB_DOCUMENTS.length >= 15, `${KB_DOCUMENTS.length} documents`);

  /* ---------------------------------------------------------------- */
  heading('2. Leave, end to end');

  const employee = (await hris.getEmployee('E-1001'))!;
  console.log(`  employee: ${employee.displayName} (${employee.country}, hired ${employee.hireDate})`);

  const before = (await hris.getLeaveBalances(employee.id)).find((b) => b.leaveType === 'annual')!;
  console.log(
    `  balance:  ${before.availableDays} of ${before.entitlementDays} days available ` +
      `(${before.usedDays} used, ${before.pendingDays} pending)`,
  );
  check('long service earns the 30-day KSA band', before.entitlementDays >= 30);

  const request = await hris.createLeaveRequest({
    employeeId: employee.id,
    leaveType: 'annual',
    startDate: '2026-12-10',
    endDate: '2026-12-15',
    notes: 'Family visit',
  });
  check('request created', request.status === 'pending', `${request.id}, ${request.days} days`);
  check('day count is inclusive', request.days === 6, '10 to 15 December is 6 days');

  const during = (await hris.getLeaveBalances(employee.id)).find((b) => b.leaveType === 'annual')!;
  check('pending days reserved against the balance', during.availableDays === before.availableDays - 6);

  await sheet.appendLeaveAudit({
    recordedAt: new Date().toISOString(),
    requestId: request.id,
    employeeId: employee.id,
    employeeName: employee.displayName,
    country: employee.country,
    leaveType: 'annual',
    startDate: request.startDate,
    endDate: request.endDate,
    days: request.days,
    decision: 'submitted',
    decidedBy: '',
    channel: 'web',
  });

  // The wrong manager must be refused.
  let refused = false;
  try {
    await hris.setLeaveRequestStatus(request.id, 'approved', 'M-2002');
  } catch {
    refused = true;
  }
  check('a manager who is not the line manager is refused', refused);

  const decided = await hris.setLeaveRequestStatus(
    request.id,
    'approved',
    employee.supervisorId,
    'Cover arranged',
  );
  check('the line manager can approve', decided.status === 'approved', `by ${decided.decidedBy}`);

  await sheet.appendLeaveAudit({
    recordedAt: new Date().toISOString(),
    requestId: decided.id,
    employeeId: employee.id,
    employeeName: employee.displayName,
    country: employee.country,
    leaveType: 'annual',
    startDate: decided.startDate,
    endDate: decided.endDate,
    days: decided.days,
    decision: 'approved',
    decidedBy: employee.supervisorId,
    channel: 'web',
  });

  /* ---------------------------------------------------------------- */
  heading('3. Entitlement across the four countries');

  for (const country of COUNTRIES) {
    const rule = leaveRuleFor(country, 'annual');
    if (!rule) continue;
    const junior = calculateEntitlement({ hireDate: '2024-01-01', asOf: REFERENCE }, rule);
    const senior = calculateEntitlement({ hireDate: '2010-01-01', asOf: REFERENCE }, rule);
    console.log(
      `  ${country}  2 years: ${String(junior.days).padStart(2)} days   ` +
        `16 years: ${String(senior.days).padStart(2)} days   (${rule.dayBasis}) ${rule.citation}`,
    );
    check(`${country} entitlement is source-verified`, rule.verified);
  }

  /* ---------------------------------------------------------------- */
  heading('4. End-of-service across the four countries');

  for (const country of COUNTRIES as CountryCode[]) {
    const rule = gratuityRuleFor(country);
    const result = calculateGratuity(
      {
        monthlyWage: 12_000,
        hireDate: '2018-03-01',
        endDate: '2026-03-01',
        separationReason: 'resignation',
      },
      rule,
      CURRENCIES[country],
    );

    if (result.notApplicable) {
      console.log(`  ${country}  no statutory gratuity — ${result.rule.citation}`);
      check(`${country} explains what applies instead`, Boolean(result.alternativeProvision));
    } else {
      console.log(
        `  ${country}  ${result.amount.toLocaleString('en-US')} ${result.currency} ` +
          `on resignation at 8 years (x${result.reductionMultiplier.toFixed(3)}, ${result.rule.wageBase})`,
      );
    }
  }

  // The hand-worked Saudi figure, as a regression guard.
  const ksa = calculateGratuity(
    {
      monthlyWage: 12_000,
      hireDate: '2018-03-01',
      endDate: '2026-03-01',
      separationReason: 'resignation',
    },
    gratuityRuleFor('SA'),
    'SAR',
  );
  check('the hand-worked KSA figure holds', Math.abs(ksa.amount - 44_043.84) < 0.01, `${ksa.amount} SAR`);
  check('the breakdown shows its working', ksa.breakdown.length >= 5, `${ksa.breakdown.length} steps`);
  check('the breakdown is bilingual', ksa.breakdown.every((s) => /[؀-ۿ]/.test(s.detail.ar)));

  /* ---------------------------------------------------------------- */
  heading('5. Residency permit sweep');

  const holders = await hris.listEmployeesWithPermits();
  const statuses = holders.map((e) =>
    checkIqamaExpiry({
      employeeId: e.id,
      expiryDate: e.residencyPermitExpiry!,
      asOf: REFERENCE,
      documentType: e.residencyPermitType ?? 'iqama',
    }),
  );

  for (const s of sortByUrgency(statuses)) {
    const person = holders.find((e) => e.id === s.employeeId)!;
    console.log(
      `  ${s.severity.padEnd(9)} ${String(s.daysRemaining).padStart(5)}d  ` +
        `${person.displayName} (${person.location})`,
    );
  }

  const alerts = dueForAlert(statuses);
  check('the sweep finds people to alert', alerts.length > 0, `${alerts.length} due today`);
  check('an expired permit is present for the demo', statuses.some((s) => s.severity === 'expired'));
  check('alert messages are bilingual', alerts.every((a) => /[؀-ۿ]/.test(a.message.ar)));

  const watchRows = sortByUrgency(statuses.filter((s) => s.daysRemaining <= 90)).map((s) => {
    const person = holders.find((e) => e.id === s.employeeId)!;
    return {
      refreshedAt: new Date().toISOString(),
      employeeId: s.employeeId,
      employeeName: person.displayName,
      country: person.country,
      document: s.documentLabel.en,
      expiryDate: s.expiryDate,
      daysRemaining: s.daysRemaining,
      severity: s.severity,
      lineManager: person.supervisorName,
    };
  });
  await sheet.replaceIqamaWatchlist(watchRows);

  // A sample of the message an employee actually receives.
  const worst = sortByUrgency(statuses)[0]!;
  console.log(`\n  sample alert (ar): ${pick(worst.message, 'ar')}`);

  /* ---------------------------------------------------------------- */
  heading('6. SOP gap and the ops summary');

  await sheet.appendSopGap({
    loggedAt: new Date().toISOString(),
    reference: 'GAP-2026-0001',
    employeeId: 'E-1003',
    country: 'SA',
    channel: 'whatsapp',
    language: 'ar',
    question: 'كيف أنقل كفالة زوجتي إلي؟',
    bestMatchScore: 0.31,
    status: 'open',
    assignedTo: 'hr-ops',
  });

  const summary = await sheet.readOpsSummary(7);
  console.log(`  gaps logged:     ${summary.sopGaps.total} (${summary.sopGaps.open} open)`);
  console.log(`  leave decisions: ${summary.leave.submitted} submitted, ${summary.leave.approved} approved, ${summary.leave.daysApproved} days`);
  console.log(`  permit watchlist: ${summary.iqama.total} (${summary.iqama.expired} expired, ${summary.iqama.critical} critical)`);

  check('the gap reached the sheet', summary.sopGaps.total === 1);
  check('both leave rows reached the sheet', summary.leave.submitted === 1 && summary.leave.approved === 1);
  check('approved days are counted', summary.leave.daysApproved === 6);
  check('the watchlist is populated', summary.iqama.total === watchRows.length);

  /* ---------------------------------------------------------------- */
  console.log('');
  if (failures === 0) {
    console.log('\x1b[32mAll smoke checks passed.\x1b[0m No credentials were used.');
  } else {
    console.log(`\x1b[31m${failures} smoke check(s) failed.\x1b[0m`);
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error('Smoke run threw:', error);
  process.exitCode = 1;
});
