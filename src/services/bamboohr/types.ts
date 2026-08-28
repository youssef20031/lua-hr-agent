/**
 * The HRIS contract.
 *
 * Domain-shaped rather than BambooHR-shaped: tools ask for "this employee's
 * leave balances", not for `GET /v1/employees/{id}/time_off/calculator`. That
 * boundary is what lets the fixture client be a faithful stand-in, and it means
 * a future migration off BambooHR touches one folder.
 */
import type { CountryCode, Language, LeaveType } from '../../domain/types.js';

export interface Employee {
  id: string;
  firstName: string;
  lastName: string;
  displayName: string;
  /** Arabic display name, where the HRIS holds one. */
  displayNameAr?: string;
  workEmail: string;
  mobilePhone: string;
  /** ISO date. Drives every tenure-based entitlement. */
  hireDate: string;
  country: CountryCode;
  department: string;
  division: string;
  location: string;
  jobTitle: string;
  /** Employee id of the line manager, empty for the top of a chain. */
  supervisorId: string;
  supervisorName: string;
  supervisorEmail: string;
  employmentStatus: 'active' | 'on_leave' | 'terminated';
  /** Monthly wage on the basis the country rule expects. */
  monthlyWage: number;
  currency: string;
  /**
   * Iqama expiry for KSA staff, Emirates ID expiry for UAE staff.
   * Held in BambooHR as a custom field, so it is optional by construction.
   */
  residencyPermitExpiry?: string;
  residencyPermitType?: 'iqama' | 'emirates_id';
  /** Preferred correspondence language, where known. */
  preferredLanguage?: Language;
  /** True for field staff who are reachable on WhatsApp rather than email. */
  isFieldWorker: boolean;
  /** True when this person may approve leave and see HR-only tools. */
  isHrStaff: boolean;
}

export interface LeaveBalance {
  leaveType: LeaveType;
  /** Days granted for the current leave year. */
  entitlementDays: number;
  /** Days already taken. */
  usedDays: number;
  /** Days requested but not yet decided. */
  pendingDays: number;
  /** entitlement - used - pending */
  availableDays: number;
  /** Days carried in from the previous year, where the policy allows it. */
  carriedOverDays: number;
  asOf: string;
}

export type LeaveRequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface LeaveRequest {
  id: string;
  employeeId: string;
  employeeName: string;
  leaveType: LeaveType;
  /** ISO date, inclusive. */
  startDate: string;
  /** ISO date, inclusive. */
  endDate: string;
  /** Inclusive day count. */
  days: number;
  status: LeaveRequestStatus;
  notes: string;
  createdAt: string;
  /** Employee id of the approver, once decided. */
  decidedBy?: string;
  decidedAt?: string;
  decisionNote?: string;
}

export interface CreateLeaveRequestInput {
  employeeId: string;
  leaveType: LeaveType;
  startDate: string;
  endDate: string;
  notes?: string;
}

export interface ListLeaveRequestsQuery {
  employeeId?: string;
  /** ISO date, inclusive. Required by the live API. */
  start?: string;
  /** ISO date, inclusive. Required by the live API. */
  end?: string;
  status?: LeaveRequestStatus;
  /** Only requests the given manager is entitled to decide. */
  approvableBy?: string;
}

export interface TimeOffType {
  id: string;
  leaveType: LeaveType;
  name: string;
  nameAr: string;
}

export interface HrisHealth {
  ok: boolean;
  mode: 'live' | 'fixture';
  detail: string;
  employeeCount?: number;
}

export class HrisError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly body?: string,
  ) {
    super(message);
    this.name = 'HrisError';
  }
}

/** Raised when a caller tries to act on a record they are not entitled to touch. */
export class HrisPermissionError extends HrisError {
  constructor(message: string) {
    super(message, 403);
    this.name = 'HrisPermissionError';
  }
}

export interface HrisClient {
  readonly mode: 'live' | 'fixture';

  getEmployee(employeeId: string): Promise<Employee | null>;
  /** Resolves the signed-in person from whatever identity the channel gives us. */
  findEmployee(by: { email?: string; phone?: string; name?: string }): Promise<Employee | null>;
  listEmployees(filter?: { country?: CountryCode; supervisorId?: string }): Promise<Employee[]>;
  /** Everyone with a residency permit on file, for the expiry sweep. */
  listEmployeesWithPermits(): Promise<Employee[]>;

  getLeaveBalances(employeeId: string): Promise<LeaveBalance[]>;
  listLeaveRequests(query: ListLeaveRequestsQuery): Promise<LeaveRequest[]>;
  getLeaveRequest(requestId: string): Promise<LeaveRequest | null>;
  createLeaveRequest(input: CreateLeaveRequestInput): Promise<LeaveRequest>;
  setLeaveRequestStatus(
    requestId: string,
    status: Exclude<LeaveRequestStatus, 'pending'>,
    actorEmployeeId: string,
    note?: string,
  ): Promise<LeaveRequest>;

  listTimeOffTypes(): Promise<TimeOffType[]>;

  health(): Promise<HrisHealth>;
}
