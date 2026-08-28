/**
 * Iqama (Saudi residence permit) expiry monitoring.
 *
 * An expired Iqama is not a paperwork nuisance: the employee loses legal
 * residency, cannot travel or bank normally, and the employer is exposed to
 * fines. The whole point of the alerting bands is that nobody should ever reach
 * the expired state without several escalating warnings first.
 *
 * The equivalent document is the Emirates ID in the UAE; the same banding is
 * applied there, which is why the severity logic takes the document label as a
 * parameter rather than hard-coding "Iqama".
 */
import { compareDates, daysBetween, formatDate, parseDate, today, type PlainDate } from './date.js';
import type { Bilingual } from './gratuity.js';

export type IqamaSeverity =
  /** More than 90 days remaining. Nothing to do. */
  | 'ok'
  /** 90 days or fewer. Renewal window opens; start gathering documents. */
  | 'notice'
  /** 60 days or fewer. Government relations should have the file. */
  | 'warning'
  /** 30 days or fewer. Escalate to the line manager. */
  | 'urgent'
  /** 7 days or fewer. Escalate to HR leadership. */
  | 'critical'
  /** Already past the expiry date. */
  | 'expired';

/**
 * Alert thresholds, in days remaining. Ordered most severe first so the first
 * match wins.
 */
export const IQAMA_THRESHOLDS: ReadonlyArray<{ maxDays: number; severity: IqamaSeverity }> = [
  { maxDays: 7, severity: 'critical' },
  { maxDays: 30, severity: 'urgent' },
  { maxDays: 60, severity: 'warning' },
  { maxDays: 90, severity: 'notice' },
];

/** The days-remaining values at which the sweep job actually sends a message. */
export const ALERT_DAYS: readonly number[] = [90, 60, 30, 7];

export interface IqamaStatus {
  employeeId: string;
  expiryDate: string;
  /** Negative once expired. */
  daysRemaining: number;
  severity: IqamaSeverity;
  /** True for anything other than `ok`. */
  actionRequired: boolean;
  /** True only on the exact threshold days, so the daily sweep does not spam. */
  isAlertDay: boolean;
  message: Bilingual;
  documentLabel: Bilingual;
}

const DOCUMENT_LABELS: Record<string, Bilingual> = {
  iqama: { en: 'Iqama', ar: 'الإقامة' },
  emirates_id: { en: 'Emirates ID', ar: 'الهوية الإماراتية' },
};

export function severityFor(daysRemaining: number): IqamaSeverity {
  if (daysRemaining < 0) return 'expired';
  for (const { maxDays, severity } of IQAMA_THRESHOLDS) {
    if (daysRemaining <= maxDays) return severity;
  }
  return 'ok';
}

export interface IqamaInput {
  employeeId: string;
  /** ISO expiry date. */
  expiryDate: string;
  /** Defaults to today in Riyadh. */
  asOf?: string;
  /** Key into DOCUMENT_LABELS. Defaults to `iqama`. */
  documentType?: 'iqama' | 'emirates_id';
}

export function checkIqamaExpiry(input: IqamaInput): IqamaStatus {
  const expiry = parseDate(input.expiryDate);
  const asOf = input.asOf ? parseDate(input.asOf) : today();
  const daysRemaining = daysBetween(asOf, expiry);
  const severity = severityFor(daysRemaining);
  const documentLabel = DOCUMENT_LABELS[input.documentType ?? 'iqama']!;

  return {
    employeeId: input.employeeId,
    expiryDate: formatDate(expiry),
    daysRemaining,
    severity,
    actionRequired: severity !== 'ok',
    isAlertDay: ALERT_DAYS.includes(daysRemaining),
    documentLabel,
    message: messageFor(severity, daysRemaining, formatDate(expiry), documentLabel),
  };
}

function messageFor(
  severity: IqamaSeverity,
  days: number,
  expiry: string,
  doc: Bilingual,
): Bilingual {
  switch (severity) {
    case 'expired':
      return {
        en: `Your ${doc.en} expired on ${expiry}, ${Math.abs(days)} days ago. This affects your legal residency. Contact Government Relations today — do not travel until it is resolved.`,
        ar: `انتهت ${doc.ar} الخاصة بك بتاريخ ${expiry}، أي قبل ${Math.abs(days)} يوماً. هذا يؤثر على إقامتك النظامية. يُرجى التواصل مع إدارة العلاقات الحكومية اليوم، وعدم السفر حتى تسوية الوضع.`,
      };
    case 'critical':
      return {
        en: `Your ${doc.en} expires in ${days} days, on ${expiry}. This is now urgent. Government Relations has been notified and HR leadership is copied.`,
        ar: `تنتهي ${doc.ar} الخاصة بك خلال ${days} أيام، بتاريخ ${expiry}. الأمر عاجل الآن. تم إبلاغ إدارة العلاقات الحكومية وإدارة الموارد البشرية.`,
      };
    case 'urgent':
      return {
        en: `Your ${doc.en} expires in ${days} days, on ${expiry}. Please submit your renewal documents this week. Your line manager has been notified.`,
        ar: `تنتهي ${doc.ar} الخاصة بك خلال ${days} يوماً، بتاريخ ${expiry}. يُرجى تقديم مستندات التجديد هذا الأسبوع. تم إبلاغ مديرك المباشر.`,
      };
    case 'warning':
      return {
        en: `Your ${doc.en} expires in ${days} days, on ${expiry}. Government Relations should now have your file. Please confirm your passport is valid for at least six more months.`,
        ar: `تنتهي ${doc.ar} الخاصة بك خلال ${days} يوماً، بتاريخ ${expiry}. من المفترض أن يكون ملفك لدى إدارة العلاقات الحكومية. يُرجى التأكد من صلاحية جواز سفرك لمدة ستة أشهر على الأقل.`,
      };
    case 'notice':
      return {
        en: `Your ${doc.en} expires in ${days} days, on ${expiry}. The renewal window is open. Start gathering your documents — see the ${doc.en} Renewal procedure.`,
        ar: `تنتهي ${doc.ar} الخاصة بك خلال ${days} يوماً، بتاريخ ${expiry}. فترة التجديد مفتوحة الآن. يُرجى البدء بتجهيز مستنداتك، واطلاع على إجراء تجديد ${doc.ar}.`,
      };
    case 'ok':
    default:
      return {
        en: `Your ${doc.en} is valid until ${expiry}, ${days} days from now. No action is needed.`,
        ar: `${doc.ar} الخاصة بك سارية حتى ${expiry}، أي بعد ${days} يوماً من الآن. لا يلزم اتخاذ أي إجراء.`,
      };
  }
}

/** Ranks a batch of statuses most-urgent-first, for the HR watchlist and digest. */
export function sortByUrgency(statuses: IqamaStatus[]): IqamaStatus[] {
  return [...statuses].sort((a, b) => a.daysRemaining - b.daysRemaining);
}

/** Everything that needs an alert today, for the daily sweep job. */
export function dueForAlert(statuses: IqamaStatus[]): IqamaStatus[] {
  return sortByUrgency(statuses.filter((s) => s.isAlertDay || s.severity === 'expired'));
}

/** Convenience for the sweep job: is this date within the monitoring horizon at all? */
export function withinHorizon(expiryDate: string, horizonDays = 90, asOf?: PlainDate): boolean {
  const expiry = parseDate(expiryDate);
  const from = asOf ?? today();
  if (compareDates(expiry, from) < 0) return true; // already expired: always in scope
  return daysBetween(from, expiry) <= horizonDays;
}
