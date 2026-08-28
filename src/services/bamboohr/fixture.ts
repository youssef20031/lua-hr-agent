/**
 * Fixture HRIS.
 *
 * A working in-memory HRIS, not a set of canned responses: it computes
 * entitlements from the same rule tables the live path uses, enforces the same
 * validation, and mutates state when a request is created or decided. Anything
 * the agent can do against BambooHR it can do here, which is what makes
 * `npm install && npm test` on a fresh clone a real exercise of the system.
 */
import {
  SEED_CARRIED_OVER,
  SEED_EMPLOYEES,
  SEED_LEAVE_REQUESTS,
  SEED_USED_DAYS,
  type SeedEmployee,
} from '../../../fixtures/hris.js';
import { calculateEntitlement } from '../../domain/entitlement.js';
import { leaveRuleFor } from '../../domain/rules/leave.js';
import { addDays, formatDate, inclusiveDays, parseDate, today } from '../../domain/date.js';
import type { CountryCode, LeaveType } from '../../domain/types.js';
import {
  HrisError,
  HrisPermissionError,
  type CreateLeaveRequestInput,
  type Employee,
  type HrisClient,
  type HrisHealth,
  type LeaveBalance,
  type LeaveRequest,
  type ListLeaveRequestsQuery,
  type ListLeaveRequestsQuery as Query,
  type TimeOffType,
} from './types.js';

const TIME_OFF_TYPES: TimeOffType[] = [
  { id: '1', leaveType: 'annual', name: 'Annual Leave', nameAr: 'إجازة سنوية' },
  { id: '2', leaveType: 'sick', name: 'Sick Leave', nameAr: 'إجازة مرضية' },
  { id: '3', leaveType: 'emergency', name: 'Emergency Leave', nameAr: 'إجازة اضطرارية' },
  { id: '4', leaveType: 'unpaid', name: 'Unpaid Leave', nameAr: 'إجازة بدون راتب' },
  { id: '5', leaveType: 'hajj', name: 'Hajj Leave', nameAr: 'إجازة حج' },
  { id: '6', leaveType: 'maternity', name: 'Maternity Leave', nameAr: 'إجازة وضع' },
  { id: '7', leaveType: 'bereavement', name: 'Bereavement Leave', nameAr: 'إجازة وفاة' },
];

export interface FixtureHrisOptions {
  /** Fixed reference date, so permit offsets and tests are deterministic. */
  referenceDate?: string;
  /** Overrides the seed population. */
  employees?: SeedEmployee[];
}

export class FixtureHrisClient implements HrisClient {
  readonly mode = 'fixture' as const;

  private readonly employees: Employee[];
  private readonly requests: LeaveRequest[];
  private readonly reference: string;
  private nextRequestId = 6000;

  constructor(opts: FixtureHrisOptions = {}) {
    this.reference = opts.referenceDate ?? formatDate(today());
    const refDate = parseDate(this.reference);

    // Materialise relative permit expiries against the reference date, so the
    // alert bands land in the right places whenever this is run.
    this.employees = (opts.employees ?? SEED_EMPLOYEES).map((seed) => {
      const { permitExpiryOffsetDays, ...rest } = seed;
      const employee: Employee = { ...rest };
      if (permitExpiryOffsetDays !== undefined) {
        employee.residencyPermitExpiry = formatDate(addDays(refDate, permitExpiryOffsetDays));
      }
      return employee;
    });

    this.requests = SEED_LEAVE_REQUESTS.map((seed) => {
      const { startOffsetDays, endOffsetDays, createdOffsetDays, ...rest } = seed;
      return {
        ...rest,
        startDate: formatDate(addDays(refDate, startOffsetDays)),
        endDate: formatDate(addDays(refDate, endOffsetDays)),
        createdAt: `${formatDate(addDays(refDate, createdOffsetDays))}T09:00:00.000Z`,
        ...(rest.decidedBy
          ? { decidedAt: `${formatDate(addDays(refDate, createdOffsetDays + 1))}T09:00:00.000Z` }
          : {}),
      };
    });
  }

  async getEmployee(employeeId: string): Promise<Employee | null> {
    return this.employees.find((e) => e.id === employeeId) ?? null;
  }

  async findEmployee(by: {
    email?: string;
    phone?: string;
    name?: string;
  }): Promise<Employee | null> {
    const { email, phone, name } = by;
    if (email) {
      const hit = this.employees.find(
        (e) => e.workEmail.toLowerCase() === email.trim().toLowerCase(),
      );
      if (hit) return hit;
    }
    if (phone) {
      const normalised = normalisePhone(phone);
      const hit = this.employees.find((e) => normalisePhone(e.mobilePhone) === normalised);
      if (hit) return hit;
    }
    if (name) {
      const needle = name.trim().toLowerCase();
      const hit = this.employees.find(
        (e) =>
          e.displayName.toLowerCase() === needle ||
          e.displayNameAr === name.trim() ||
          e.displayName.toLowerCase().includes(needle),
      );
      if (hit) return hit;
    }
    return null;
  }

  async listEmployees(filter: { country?: CountryCode; supervisorId?: string } = {}): Promise<Employee[]> {
    return this.employees.filter(
      (e) =>
        (filter.country === undefined || e.country === filter.country) &&
        (filter.supervisorId === undefined || e.supervisorId === filter.supervisorId),
    );
  }

  async listEmployeesWithPermits(): Promise<Employee[]> {
    return this.employees.filter((e) => Boolean(e.residencyPermitExpiry));
  }

  async getLeaveBalances(employeeId: string): Promise<LeaveBalance[]> {
    const employee = await this.requireEmployee(employeeId);
    const used = SEED_USED_DAYS[employeeId] ?? {};
    const carried = SEED_CARRIED_OVER[employeeId] ?? 0;

    const balances: LeaveBalance[] = [];
    for (const type of ['annual', 'sick', 'emergency'] as LeaveType[]) {
      const rule = leaveRuleFor(employee.country, type);
      if (!rule) continue;

      const entitlement = calculateEntitlement(
        { hireDate: employee.hireDate, asOf: this.reference },
        rule,
      );
      const usedDays = used[type] ?? 0;
      const pendingDays = this.requests
        .filter((r) => r.employeeId === employeeId && r.leaveType === type && r.status === 'pending')
        .reduce((sum, r) => sum + r.days, 0);
      const carriedOverDays = type === 'annual' ? carried : 0;
      const entitlementDays = entitlement.days + carriedOverDays;

      balances.push({
        leaveType: type,
        entitlementDays,
        usedDays,
        pendingDays,
        availableDays: Math.max(0, entitlementDays - usedDays - pendingDays),
        carriedOverDays,
        asOf: this.reference,
      });
    }
    return balances;
  }

  async listLeaveRequests(query: Query = {}): Promise<LeaveRequest[]> {
    let results = [...this.requests];

    if (query.employeeId) {
      results = results.filter((r) => r.employeeId === query.employeeId);
    }
    if (query.status) {
      results = results.filter((r) => r.status === query.status);
    }
    if (query.approvableBy) {
      const reports = new Set(
        this.employees.filter((e) => e.supervisorId === query.approvableBy).map((e) => e.id),
      );
      results = results.filter((r) => reports.has(r.employeeId));
    }
    // The live API requires start and end, and filters on overlap rather than
    // containment. Mirroring that here keeps the two implementations honest.
    if (query.start || query.end) {
      const from = query.start ? parseDate(query.start) : parseDate('1900-01-01');
      const to = query.end ? parseDate(query.end) : parseDate('2999-12-31');
      results = results.filter((r) => {
        const s = parseDate(r.startDate);
        const e = parseDate(r.endDate);
        return !(
          e.year * 10000 + e.month * 100 + e.day < from.year * 10000 + from.month * 100 + from.day ||
          s.year * 10000 + s.month * 100 + s.day > to.year * 10000 + to.month * 100 + to.day
        );
      });
    }

    return results.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async getLeaveRequest(requestId: string): Promise<LeaveRequest | null> {
    return this.requests.find((r) => r.id === requestId) ?? null;
  }

  async createLeaveRequest(input: CreateLeaveRequestInput): Promise<LeaveRequest> {
    const employee = await this.requireEmployee(input.employeeId);

    const start = parseDate(input.startDate);
    const end = parseDate(input.endDate);
    const days = inclusiveDays(start, end);
    if (days < 1) {
      throw new HrisError('The end date must be on or after the start date.');
    }

    // Overlap check. BambooHR rejects these too, and catching it here gives a
    // far better message than a raw API validation error.
    const overlap = this.requests.find(
      (r) =>
        r.employeeId === input.employeeId &&
        (r.status === 'pending' || r.status === 'approved') &&
        !(r.endDate < input.startDate || r.startDate > input.endDate),
    );
    if (overlap) {
      throw new HrisError(
        `This overlaps an existing ${overlap.status} request (${overlap.id}) from ${overlap.startDate} to ${overlap.endDate}.`,
      );
    }

    const request: LeaveRequest = {
      id: `LR-${this.nextRequestId++}`,
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
    this.requests.push(request);
    return request;
  }

  async setLeaveRequestStatus(
    requestId: string,
    status: 'approved' | 'rejected' | 'cancelled',
    actorEmployeeId: string,
    note?: string,
  ): Promise<LeaveRequest> {
    const request = this.requests.find((r) => r.id === requestId);
    if (!request) throw new HrisError(`Leave request ${requestId} was not found.`, 404);

    const subject = await this.requireEmployee(request.employeeId);
    const actor = await this.requireEmployee(actorEmployeeId);

    // Authorisation lives here rather than in the tool, so both the fixture and
    // the live client enforce it and no caller can route around it.
    const isLineManager = subject.supervisorId === actorEmployeeId;
    const isSelfCancel = status === 'cancelled' && actorEmployeeId === request.employeeId;
    if (!isLineManager && !actor.isHrStaff && !isSelfCancel) {
      throw new HrisPermissionError(
        `${actor.displayName} is not the line manager for ${subject.displayName} and is not HR staff, so cannot ${status.replace(/ed$/, '')} this request.`,
      );
    }

    if (request.status !== 'pending') {
      throw new HrisError(
        `Leave request ${requestId} is already ${request.status} and cannot be changed.`,
      );
    }

    request.status = status;
    request.decidedBy = actorEmployeeId;
    request.decidedAt = new Date().toISOString();
    if (note) request.decisionNote = note;
    return request;
  }

  async listTimeOffTypes(): Promise<TimeOffType[]> {
    return TIME_OFF_TYPES;
  }

  async health(): Promise<HrisHealth> {
    return {
      ok: true,
      mode: 'fixture',
      detail: `In-memory HRIS seeded with ${this.employees.length} employees, reference date ${this.reference}. No BambooHR credentials in use.`,
      employeeCount: this.employees.length,
    };
  }

  private async requireEmployee(employeeId: string): Promise<Employee> {
    const employee = await this.getEmployee(employeeId);
    if (!employee) throw new HrisError(`Employee ${employeeId} was not found.`, 404);
    return employee;
  }
}

/** Strips spacing and punctuation so +966 50 123 4001 matches +966501234001. */
function normalisePhone(phone: string): string {
  return phone.replace(/[^\d]/g, '').replace(/^00/, '');
}

export { TIME_OFF_TYPES };
export type { ListLeaveRequestsQuery };
