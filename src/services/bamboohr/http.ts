/**
 * Live BambooHR implementation.
 *
 * Confirmed against the BambooHR API documentation during this build:
 *
 *  - Auth is HTTP Basic with the API key as the username and any string as the
 *    password, conventionally `x`. Credentials are sent pre-emptively on every
 *    request; BambooHR explicitly recommends this, because waiting for a 401
 *    challenge doubles the round trips and burns rate-limit budget on requests
 *    that were always going to fail.
 *  - Creating a time-off request is a PUT, not a POST. This trips people up.
 *  - Throttling is signalled by 503 today and moves to 429 on 14 September 2026.
 *    Both are treated as throttling here, and `Retry-After` is honoured on
 *    either, because a client shipped now will straddle the change.
 *  - There are NO time-off webhooks. Status changes made inside BambooHR can
 *    only be discovered by polling, which is why the leave-audit job exists.
 *
 * Where a path could not be confirmed to the letter it is marked UNCONFIRMED.
 * The adapter interface is what protects the rest of the codebase from those.
 */
import {
  HrisError,
  HrisPermissionError,
  type CreateLeaveRequestInput,
  type Employee,
  type HrisClient,
  type HrisHealth,
  type LeaveBalance,
  type LeaveRequest,
  type LeaveRequestStatus,
  type ListLeaveRequestsQuery,
  type TimeOffType,
} from './types.js';
import { TIME_OFF_TYPES } from './fixture.js';
import { calculateEntitlement } from '../../domain/entitlement.js';
import { leaveRuleFor } from '../../domain/rules/leave.js';
import { formatDate, inclusiveDays, parseDate, today } from '../../domain/date.js';
import type { CountryCode, LeaveType } from '../../domain/types.js';

/** Fields requested for an employee. Aliases are BambooHR's documented names. */
const EMPLOYEE_FIELDS = [
  'firstName',
  'lastName',
  'displayName',
  'workEmail',
  'mobilePhone',
  'hireDate',
  'department',
  'division',
  'location',
  'jobTitle',
  'supervisor',
  'supervisorEmail',
  'supervisorEId',
  'country',
  'employmentHistoryStatus',
  'payRate',
  'payPer',
] as const;

export interface HttpHrisOptions {
  /** The subdomain in https://{companyDomain}.bamboohr.com */
  companyDomain: string;
  apiKey: string;
  /**
   * Base URL template. Both forms are in circulation; the gateway form is what
   * current documentation uses. Override if your tenant differs.
   */
  baseUrl?: string;
  /**
   * Name of the custom field holding Iqama / Emirates ID expiry. Custom fields
   * cannot be created through the API, so this must already exist in the tenant.
   */
  permitExpiryField?: string;
  maxRetries?: number;
  referenceDate?: string;
}

export class HttpHrisClient implements HrisClient {
  readonly mode = 'live' as const;

  private readonly baseUrl: string;
  private readonly authHeader: string;
  private readonly permitExpiryField: string;
  private readonly maxRetries: number;
  private readonly reference: string;

  constructor(opts: HttpHrisOptions) {
    if (!opts.companyDomain) {
      throw new Error(
        'BAMBOOHR_COMPANY_DOMAIN is required for the live HRIS client. It is the subdomain ' +
          'in https://{domain}.bamboohr.com, not the full URL.',
      );
    }
    if (!opts.apiKey) {
      throw new Error(
        'BAMBOOHR_API_KEY is required for the live HRIS client. Generate one from your ' +
          'BambooHR user context menu, or Settings > Account > API Keys.',
      );
    }

    this.baseUrl = (
      opts.baseUrl ?? `https://api.bamboohr.com/api/gateway.php/${opts.companyDomain}/v1`
    ).replace(/\/$/, '');
    // Basic auth: API key as username, any string as password.
    this.authHeader = `Basic ${Buffer.from(`${opts.apiKey}:x`).toString('base64')}`;
    this.permitExpiryField = opts.permitExpiryField ?? 'customIqamaExpiry';
    this.maxRetries = opts.maxRetries ?? 4;
    this.reference = opts.referenceDate ?? formatDate(today());
  }

  private async request<T>(init: {
    method: 'GET' | 'POST' | 'PUT';
    path: string;
    query?: Record<string, string | undefined>;
    body?: unknown;
    /** Some BambooHR writes return 200/201 with an empty body. */
    expectEmpty?: boolean;
  }): Promise<T> {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(init.query ?? {})) {
      if (v !== undefined) params.set(k, v);
    }
    const qs = params.toString() ? `?${params.toString()}` : '';
    const url = `${this.baseUrl}${init.path}${qs}`;

    let attempt = 0;
    for (;;) {
      const res = await fetch(url, {
        method: init.method,
        headers: {
          // Sent pre-emptively, never in response to a challenge.
          Authorization: this.authHeader,
          Accept: 'application/json',
          ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      });

      if (res.ok) {
        if (init.expectEmpty) return undefined as T;
        const text = await res.text();
        if (!text.trim()) return undefined as T;
        try {
          return JSON.parse(text) as T;
        } catch {
          throw new HrisError(
            `BambooHR returned a non-JSON body for ${init.method} ${init.path}. ` +
              `Check the Accept header and the endpoint path.`,
            res.status,
            text.slice(0, 400),
          );
        }
      }

      // 503 is throttling today; 429 becomes the throttling code on 2026-09-14.
      // Treat both as retryable so a client shipped now survives the change.
      const throttled = res.status === 429 || res.status === 503;
      if ((throttled || res.status >= 500) && attempt < this.maxRetries) {
        const retryAfter = Number(res.headers.get('retry-after'));
        const backoff =
          Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : Math.min(2 ** attempt * 1000, 16_000) + Math.floor(Math.random() * 500);
        attempt += 1;
        await new Promise((r) => setTimeout(r, backoff));
        continue;
      }

      const body = await res.text();
      throw this.decodeError(res.status, body, init);
    }
  }

  private decodeError(
    status: number,
    body: string,
    init: { method: string; path: string },
  ): HrisError {
    const where = `${init.method} ${init.path}`;
    if (status === 401) {
      return new HrisError(
        `BambooHR rejected the API key (401) on ${where}. Check BAMBOOHR_API_KEY and that the key has not been disabled.`,
        status,
        body,
      );
    }
    if (status === 403) {
      // BambooHR scopes the API to the permissions of the key's owning user.
      return new HrisPermissionError(
        `BambooHR denied access (403) on ${where}. The API key inherits its owner's permissions, ` +
          `so the user behind this key probably cannot see or edit that employee or field.`,
      );
    }
    if (status === 404) {
      return new HrisError(
        `BambooHR returned 404 on ${where}. Check the company domain and the record id.`,
        status,
        body,
      );
    }
    return new HrisError(`BambooHR error ${status} on ${where}: ${body.slice(0, 300)}`, status, body);
  }

  async getEmployee(employeeId: string): Promise<Employee | null> {
    try {
      const raw = await this.request<Record<string, unknown>>({
        method: 'GET',
        path: `/employees/${encodeURIComponent(employeeId)}`,
        query: { fields: [...EMPLOYEE_FIELDS, this.permitExpiryField].join(',') },
      });
      return this.toEmployee(raw);
    } catch (error) {
      if (error instanceof HrisError && error.status === 404) return null;
      throw error;
    }
  }

  async findEmployee(by: { email?: string; phone?: string; name?: string }): Promise<Employee | null> {
    // The directory is the only bulk read that does not need per-record
    // permissions, so identity resolution goes through it.
    const all = await this.listEmployees();
    const { email, phone, name } = by;

    if (email) {
      const hit = all.find((e) => e.workEmail.toLowerCase() === email.trim().toLowerCase());
      if (hit) return this.getEmployee(hit.id);
    }
    if (phone) {
      const needle = phone.replace(/[^\d]/g, '');
      const hit = all.find((e) => e.mobilePhone.replace(/[^\d]/g, '') === needle);
      if (hit) return this.getEmployee(hit.id);
    }
    if (name) {
      const needle = name.trim().toLowerCase();
      const hit = all.find((e) => e.displayName.toLowerCase().includes(needle));
      if (hit) return this.getEmployee(hit.id);
    }
    return null;
  }

  async listEmployees(
    filter: { country?: CountryCode; supervisorId?: string } = {},
  ): Promise<Employee[]> {
    const raw = await this.request<{ employees?: Record<string, unknown>[] }>({
      method: 'GET',
      path: '/employees/directory',
    });
    const employees = (raw.employees ?? []).map((e) => this.toEmployee(e));
    return employees.filter(
      (e) =>
        (filter.country === undefined || e.country === filter.country) &&
        (filter.supervisorId === undefined || e.supervisorId === filter.supervisorId),
    );
  }

  async listEmployeesWithPermits(): Promise<Employee[]> {
    // The directory does not carry custom fields, so each record is re-read.
    // Fine for a nightly sweep at this population size; a real 50k-employee
    // tenant would use a custom report instead.
    const directory = await this.listEmployees();
    const detailed = await Promise.all(directory.map((e) => this.getEmployee(e.id)));
    return detailed.filter((e): e is Employee => Boolean(e?.residencyPermitExpiry));
  }

  async getLeaveBalances(employeeId: string): Promise<LeaveBalance[]> {
    const employee = await this.getEmployee(employeeId);
    if (!employee) throw new HrisError(`Employee ${employeeId} was not found.`, 404);

    // UNCONFIRMED path. BambooHR exposes a time-off estimate endpoint whose
    // exact shape varies by tenant configuration, so the used/pending figures
    // are derived from request history, which is documented and stable, and the
    // entitlement is computed from the statutory rule tables.
    const yearStart = `${this.reference.slice(0, 4)}-01-01`;
    const yearEnd = `${this.reference.slice(0, 4)}-12-31`;
    const requests = await this.listLeaveRequests({
      employeeId,
      start: yearStart,
      end: yearEnd,
    });

    const balances: LeaveBalance[] = [];
    for (const type of ['annual', 'sick', 'emergency'] as LeaveType[]) {
      const rule = leaveRuleFor(employee.country, type);
      if (!rule) continue;

      const entitlement = calculateEntitlement(
        { hireDate: employee.hireDate, asOf: this.reference },
        rule,
      );
      const forType = requests.filter((r) => r.leaveType === type);
      const usedDays = forType
        .filter((r) => r.status === 'approved')
        .reduce((s, r) => s + r.days, 0);
      const pendingDays = forType
        .filter((r) => r.status === 'pending')
        .reduce((s, r) => s + r.days, 0);

      balances.push({
        leaveType: type,
        entitlementDays: entitlement.days,
        usedDays,
        pendingDays,
        availableDays: Math.max(0, entitlement.days - usedDays - pendingDays),
        carriedOverDays: 0,
        asOf: this.reference,
      });
    }
    return balances;
  }

  async listLeaveRequests(query: ListLeaveRequestsQuery = {}): Promise<LeaveRequest[]> {
    // start and end are mandatory on this endpoint, and the filter is on
    // overlap rather than containment. Defaulting to a wide window keeps the
    // adapter's contract (both optional) intact.
    const start = query.start ?? `${Number(this.reference.slice(0, 4)) - 1}-01-01`;
    const end = query.end ?? `${Number(this.reference.slice(0, 4)) + 1}-12-31`;

    const raw = await this.request<Record<string, unknown>[]>({
      method: 'GET',
      path: '/time_off/requests',
      query: {
        start,
        end,
        employeeId: query.employeeId,
        status: query.status ? mapStatusOut(query.status) : undefined,
        action: query.approvableBy ? 'view' : undefined,
      },
    });

    return (Array.isArray(raw) ? raw : []).map((r) => this.toLeaveRequest(r));
  }

  async getLeaveRequest(requestId: string): Promise<LeaveRequest | null> {
    const all = await this.listLeaveRequests({});
    return all.find((r) => r.id === requestId) ?? null;
  }

  async createLeaveRequest(input: CreateLeaveRequestInput): Promise<LeaveRequest> {
    const employee = await this.getEmployee(input.employeeId);
    if (!employee) throw new HrisError(`Employee ${input.employeeId} was not found.`, 404);

    const days = inclusiveDays(parseDate(input.startDate), parseDate(input.endDate));
    const typeId = TIME_OFF_TYPES.find((t) => t.leaveType === input.leaveType)?.id;
    if (!typeId) {
      throw new HrisError(`No BambooHR time-off type is mapped for "${input.leaveType}".`);
    }

    // PUT, not POST. This is the detail that most often gets this wrong.
    const created = await this.request<{ id?: string | number }>({
      method: 'PUT',
      path: `/employees/${encodeURIComponent(input.employeeId)}/time_off/request`,
      body: {
        status: 'requested',
        start: input.startDate,
        end: input.endDate,
        timeOffTypeId: typeId,
        amount: String(days),
        notes: { employee: input.notes ?? '' },
      },
    });

    return {
      id: created?.id !== undefined ? String(created.id) : `pending-${Date.now()}`,
      employeeId: employee.id,
      employeeName: employee.displayName,
      leaveType: input.leaveType,
      startDate: input.startDate,
      endDate: input.endDate,
      days,
      status: 'pending',
      notes: input.notes ?? '',
      createdAt: new Date().toISOString(),
    };
  }

  async setLeaveRequestStatus(
    requestId: string,
    status: 'approved' | 'rejected' | 'cancelled',
    actorEmployeeId: string,
    note?: string,
  ): Promise<LeaveRequest> {
    await this.request({
      method: 'PUT',
      path: `/time_off/requests/${encodeURIComponent(requestId)}/status`,
      body: { status: mapStatusOut(status), note: note ?? '' },
      expectEmpty: true,
    });

    const updated = await this.getLeaveRequest(requestId);
    if (!updated) {
      throw new HrisError(`Leave request ${requestId} could not be re-read after the update.`, 404);
    }
    return { ...updated, decidedBy: actorEmployeeId, decidedAt: new Date().toISOString() };
  }

  async listTimeOffTypes(): Promise<TimeOffType[]> {
    try {
      const raw = await this.request<{ timeOffTypes?: Array<{ id: number | string; name: string }> }>(
        { method: 'GET', path: '/meta/time_off/types' },
      );
      const remote = raw.timeOffTypes ?? [];
      if (remote.length === 0) return TIME_OFF_TYPES;
      // Map remote names onto our leave types where we recognise them.
      return remote.map((t) => {
        const known = TIME_OFF_TYPES.find((k) =>
          t.name.toLowerCase().includes(k.leaveType === 'annual' ? 'vacation' : k.leaveType),
        );
        return {
          id: String(t.id),
          leaveType: known?.leaveType ?? 'unpaid',
          name: t.name,
          nameAr: known?.nameAr ?? t.name,
        };
      });
    } catch {
      // Type metadata is a nicety, not a dependency.
      return TIME_OFF_TYPES;
    }
  }

  async health(): Promise<HrisHealth> {
    try {
      const raw = await this.request<{ employees?: unknown[] }>({
        method: 'GET',
        path: '/employees/directory',
      });
      const count = raw.employees?.length ?? 0;
      return {
        ok: true,
        mode: 'live',
        detail: `Connected to BambooHR at ${this.baseUrl}.`,
        employeeCount: count,
      };
    } catch (error) {
      return {
        ok: false,
        mode: 'live',
        detail: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /* ---------------------------------------------------------------------- */

  private toEmployee(raw: Record<string, unknown>): Employee {
    const s = (k: string): string => {
      const v = raw[k];
      return v === undefined || v === null ? '' : String(v);
    };

    const first = s('firstName');
    const last = s('lastName');
    const permitExpiry = s(this.permitExpiryField);
    const country = normaliseCountry(s('country'), s('location'));
    const pay = parsePay(s('payRate'), s('payPer'));

    const employee: Employee = {
      id: s('id'),
      firstName: first,
      lastName: last,
      displayName: s('displayName') || `${first} ${last}`.trim(),
      workEmail: s('workEmail'),
      mobilePhone: s('mobilePhone'),
      hireDate: s('hireDate'),
      country,
      department: s('department'),
      division: s('division'),
      location: s('location'),
      jobTitle: s('jobTitle'),
      supervisorId: s('supervisorEId'),
      supervisorName: s('supervisor'),
      supervisorEmail: s('supervisorEmail'),
      employmentStatus: s('employmentHistoryStatus').toLowerCase().includes('terminated')
        ? 'terminated'
        : 'active',
      monthlyWage: pay.monthlyWage,
      currency: pay.currency || currencyFor(country),
      isFieldWorker: /site|field|plant|warehouse|technician/i.test(s('jobTitle')),
      isHrStaff: /human resources|people/i.test(s('department')),
    };

    if (permitExpiry) {
      employee.residencyPermitExpiry = permitExpiry;
      employee.residencyPermitType = country === 'AE' ? 'emirates_id' : 'iqama';
    }
    return employee;
  }

  private toLeaveRequest(raw: Record<string, unknown>): LeaveRequest {
    const s = (k: string): string => {
      const v = raw[k];
      return v === undefined || v === null ? '' : String(v);
    };
    const statusObj = raw.status as { status?: string } | undefined;
    const typeObj = raw.type as { id?: string | number; name?: string } | undefined;
    const employeeObj = raw.employee as { id?: string | number; displayName?: string } | undefined;

    const start = s('start');
    const end = s('end');
    const mapped =
      TIME_OFF_TYPES.find((t) => String(t.id) === String(typeObj?.id ?? ''))?.leaveType ?? 'annual';

    return {
      id: s('id'),
      employeeId: String(employeeObj?.id ?? s('employeeId')),
      employeeName: String(employeeObj?.displayName ?? ''),
      leaveType: mapped,
      startDate: start,
      endDate: end,
      days:
        Number(s('amount')) ||
        (start && end ? inclusiveDays(parseDate(start), parseDate(end)) : 0),
      status: mapStatusIn(statusObj?.status ?? s('status')),
      notes: s('notes'),
      createdAt: s('created') || new Date().toISOString(),
    };
  }
}

function mapStatusOut(status: LeaveRequestStatus): string {
  switch (status) {
    case 'pending':
      return 'requested';
    case 'approved':
      return 'approved';
    case 'rejected':
      return 'denied';
    case 'cancelled':
      return 'cancelled';
  }
}

function mapStatusIn(raw: string): LeaveRequestStatus {
  const v = raw.toLowerCase();
  if (v.includes('approved')) return 'approved';
  if (v.includes('denied') || v.includes('rejected')) return 'rejected';
  if (v.includes('cancel')) return 'cancelled';
  return 'pending';
}

/**
 * Resolves one of the four covered jurisdictions from the record, or `null`
 * when it is none of them.
 *
 * This used to fall through to 'SA'. That is the wrong kind of guess: a tenant
 * holding staff outside these four countries — which includes every BambooHR
 * demo tenant — would have had all of them silently treated as Saudi, and been
 * quoted Saudi entitlements and a SAR gratuity. Saying "I cannot tell" is the
 * only honest answer, and the tools surface it.
 */
function normaliseCountry(country: string, location: string): CountryCode | null {
  const haystack = `${country} ${location}`.toLowerCase();
  if (/saudi|ksa|riyadh|jubail|jeddah|dammam|yanbu/.test(haystack)) return 'SA';
  if (/emirat|uae|dubai|abu dhabi|sharjah/.test(haystack)) return 'AE';
  if (/egypt|cairo|alexandria/.test(haystack)) return 'EG';
  if (/jordan|amman|aqaba/.test(haystack)) return 'JO';
  return null;
}

function currencyFor(country: CountryCode | null): string {
  return country ? { SA: 'SAR', AE: 'AED', EG: 'EGP', JO: 'JOD' }[country] : '';
}

/**
 * BambooHR returns `payRate` as an amount and a currency — "60000.00 GBP" — on
 * whatever basis `payPer` states, which is commonly "Year". Reading that
 * straight into a monthly wage overstates it twelvefold and carries the error
 * into every gratuity figure, so the basis has to be honoured and the currency
 * taken from the record rather than assumed from the country.
 */
export function parsePay(
  payRate: string,
  payPer: string,
): { monthlyWage: number; currency: string } {
  const amount = Number(payRate.replace(/[^\d.]/g, '')) || 0;
  const currency = (payRate.match(/[A-Za-z]{3}/)?.[0] ?? '').toUpperCase();
  return { monthlyWage: /^year/i.test(payPer) ? amount / 12 : amount, currency };
}
