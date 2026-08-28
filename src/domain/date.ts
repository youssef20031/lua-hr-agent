/**
 * Date-only arithmetic for employment tenure.
 *
 * Everything here works in UTC on calendar dates. Payroll dates are civil dates,
 * not instants; running them through a local-timezone Date is how you end up
 * paying someone for 364 days of service because the office is in Riyadh (UTC+3)
 * and the server is in Virginia.
 */

const MS_PER_DAY = 86_400_000;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A calendar date with no time and no timezone. */
export interface PlainDate {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
}

export function parseDate(input: string): PlainDate {
  const trimmed = input.trim();
  const match = ISO_DATE.exec(trimmed);
  if (!match) {
    throw new Error(`Invalid date "${input}". Expected ISO format YYYY-MM-DD.`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (month < 1 || month > 12) {
    throw new Error(`Invalid date "${input}": month ${month} is out of range.`);
  }
  if (day < 1 || day > daysInMonth(year, month)) {
    throw new Error(`Invalid date "${input}": day ${day} is out of range for that month.`);
  }
  return { year, month, day };
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function toUtcMillis(date: PlainDate): number {
  return Date.UTC(date.year, date.month - 1, date.day);
}

export function formatDate(date: PlainDate): string {
  const mm = String(date.month).padStart(2, '0');
  const dd = String(date.day).padStart(2, '0');
  return `${date.year}-${mm}-${dd}`;
}

/** Today, as a calendar date, in the given IANA timezone. Defaults to Riyadh. */
export function today(timeZone = 'Asia/Riyadh', now: Date = new Date()): PlainDate {
  // en-CA renders as YYYY-MM-DD, which parses directly.
  const formatted = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  return parseDate(formatted);
}

/**
 * Inclusive-of-start, exclusive-of-end day count.
 * `daysBetween('2024-01-01', '2024-01-02')` is 1.
 */
export function daysBetween(start: PlainDate, end: PlainDate): number {
  return Math.round((toUtcMillis(end) - toUtcMillis(start)) / MS_PER_DAY);
}

/**
 * Inclusive day count, the way leave is actually counted: a request from
 * the 10th to the 15th is six days off, not five.
 */
export function inclusiveDays(start: PlainDate, end: PlainDate): number {
  return daysBetween(start, end) + 1;
}

export function addDays(date: PlainDate, days: number): PlainDate {
  const shifted = new Date(toUtcMillis(date) + days * MS_PER_DAY);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

export function compareDates(a: PlainDate, b: PlainDate): number {
  return toUtcMillis(a) - toUtcMillis(b);
}

/** Length of service, expressed several ways because different rules need different ones. */
export interface ServiceDuration {
  /** Whole calendar years completed. */
  years: number;
  /** Whole months completed beyond `years`. */
  months: number;
  /** Whole days beyond `years` and `months`. */
  days: number;
  /** Total calendar days of service. */
  totalDays: number;
  /**
   * Service as a decimal number of years, used for pro-rata gratuity accrual.
   * Uses a 365-day year, the convention these labour codes are applied with.
   */
  decimalYears: number;
}

/**
 * Adds whole months, clamping the day to the target month's length.
 * 31 January plus one month is 29 February in a leap year, not 2 March —
 * this is what "one month of service" means for someone hired on the 31st.
 */
export function addMonthsClamped(date: PlainDate, months: number): PlainDate {
  const totalMonths = date.year * 12 + (date.month - 1) + months;
  const year = Math.floor(totalMonths / 12);
  const month = (((totalMonths % 12) + 12) % 12) + 1;
  const day = Math.min(date.day, daysInMonth(year, month));
  return { year, month, day };
}

/**
 * Calendar-accurate service length between a hire date and a separation date.
 * The end date is exclusive: hired 2020-01-01 and leaving 2021-01-01 is exactly
 * one year, not one year and a day.
 *
 * Whole months are counted by clamped month-advance rather than by subtracting
 * day numbers and borrowing. Borrowing quietly breaks for anyone hired on the
 * 29th, 30th or 31st, because a single borrow from a shorter month is not
 * always enough to make the day difference non-negative.
 */
export function serviceDuration(hireDate: PlainDate, endDate: PlainDate): ServiceDuration {
  if (compareDates(endDate, hireDate) < 0) {
    throw new Error(
      `End date ${formatDate(endDate)} precedes hire date ${formatDate(hireDate)}.`,
    );
  }

  // Upper estimate of whole months elapsed, then at most one correction: the
  // estimate always lands in the end date's own month, so it can only overshoot
  // by one.
  let wholeMonths = (endDate.year - hireDate.year) * 12 + (endDate.month - hireDate.month);
  if (wholeMonths > 0 && compareDates(addMonthsClamped(hireDate, wholeMonths), endDate) > 0) {
    wholeMonths -= 1;
  }
  if (wholeMonths < 0) wholeMonths = 0;

  const lastAnniversary = addMonthsClamped(hireDate, wholeMonths);
  const totalDays = daysBetween(hireDate, endDate);

  return {
    years: Math.floor(wholeMonths / 12),
    months: wholeMonths % 12,
    days: daysBetween(lastAnniversary, endDate),
    totalDays,
    decimalYears: totalDays / 365,
  };
}

/** Convenience wrapper taking ISO strings. */
export function serviceDurationFromStrings(hireDate: string, endDate: string): ServiceDuration {
  return serviceDuration(parseDate(hireDate), parseDate(endDate));
}
