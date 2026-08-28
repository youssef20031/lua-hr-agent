/**
 * Seed data for the fixture HRIS.
 *
 * Two deliberate choices here:
 *
 *  1. It is TypeScript, not JSON, so the compiler catches drift between the
 *     seed and the `Employee` type. Untyped fixture JSON rots silently.
 *
 *  2. Residency-permit expiry is stored as an OFFSET IN DAYS from a reference
 *     date rather than an absolute date. A hard-coded 2026-09-27 would put
 *     someone at exactly 30 days today and at minus-400 days next year, and the
 *     Iqama demo would quietly stop demonstrating anything. With offsets there
 *     is always somebody expired, somebody at 7 days, somebody at 30, and so on,
 *     whenever the repository is cloned.
 *
 * The population is small but spread across all four countries, both channels,
 * and every Iqama alert band, so the demo data tells a story rather than just
 * filling rows.
 */
import type { Employee, LeaveRequest } from '../src/services/bamboohr/types.js';

/** An employee record whose permit expiry is expressed relative to "today". */
export type SeedEmployee = Omit<Employee, 'residencyPermitExpiry'> & {
  /**
   * Days from the reference date until the permit expires.
   * Negative means already expired. Omitted means no permit on file.
   */
  permitExpiryOffsetDays?: number;
};

/**
 * Contact details for the demo protagonist, E-1001.
 *
 * The agent identifies whoever it is talking to by the email or phone the
 * channel supplies, so a live walkthrough needs the protagonist to be a real,
 * reachable person. Those are somebody's personal details and they are not
 * committed: set DEMO_EMPLOYEE_EMAIL and DEMO_EMPLOYEE_PHONE in .env locally,
 * and through `lua env` on the server. Unset, the seed keeps its placeholder
 * identity and a fresh clone still runs end to end.
 */
const DEMO_EMAIL = process.env.DEMO_EMPLOYEE_EMAIL ?? 'ahmad.alotaibi@example.com';
const DEMO_PHONE = process.env.DEMO_EMPLOYEE_PHONE ?? '+966501234001';

export const SEED_EMPLOYEES: SeedEmployee[] = [
  {
    id: 'E-1001',
    firstName: 'Ahmad',
    lastName: 'Al-Otaibi',
    displayName: 'Ahmad Al-Otaibi',
    displayNameAr: 'أحمد العتيبي',
    // See DEMO_EMAIL / DEMO_PHONE above. Phone matching normalises to digits,
    // so WhatsApp resolves with or without the leading '+'.
    workEmail: DEMO_EMAIL,
    mobilePhone: DEMO_PHONE,
    hireDate: '2018-03-01', // long service: 30 days annual leave in KSA
    country: 'SA',
    department: 'Operations',
    division: 'Industrial Services',
    location: 'Riyadh',
    jobTitle: 'Site Supervisor',
    supervisorId: 'M-2001',
    supervisorName: 'Khalid Al-Dossari',
    supervisorEmail: 'khalid.aldossari@example.com',
    employmentStatus: 'active',
    monthlyWage: 12_000,
    currency: 'SAR',
    permitExpiryOffsetDays: 30, // urgent band
    residencyPermitType: 'iqama',
    preferredLanguage: 'ar',
    isFieldWorker: true,
    isHrStaff: false,
  },
  {
    id: 'E-1002',
    firstName: 'Fatima',
    lastName: 'Al-Zahrani',
    displayName: 'Fatima Al-Zahrani',
    displayNameAr: 'فاطمة الزهراني',
    workEmail: 'fatima.alzahrani@example.com',
    mobilePhone: '+966501234002',
    hireDate: '2023-06-15', // under five years: 21 days annual leave
    country: 'SA',
    department: 'Finance',
    division: 'Corporate',
    location: 'Riyadh',
    jobTitle: 'Financial Analyst',
    supervisorId: 'M-2002',
    supervisorName: 'Reem Al-Harbi',
    supervisorEmail: 'reem.alharbi@example.com',
    employmentStatus: 'active',
    monthlyWage: 18_000,
    currency: 'SAR',
    permitExpiryOffsetDays: 90, // notice band
    residencyPermitType: 'iqama',
    preferredLanguage: 'en',
    isFieldWorker: false,
    isHrStaff: false,
  },
  {
    id: 'E-1003',
    firstName: 'Mohammed',
    lastName: 'Hassan',
    displayName: 'Mohammed Hassan',
    displayNameAr: 'محمد حسن',
    workEmail: 'mohammed.hassan@example.com',
    mobilePhone: '+966501234003',
    hireDate: '2015-01-10', // eleven years: full gratuity even on resignation
    country: 'SA',
    department: 'Maintenance',
    division: 'Industrial Services',
    location: 'Jubail',
    jobTitle: 'Senior Technician',
    supervisorId: 'M-2001',
    supervisorName: 'Khalid Al-Dossari',
    supervisorEmail: 'khalid.aldossari@example.com',
    employmentStatus: 'active',
    monthlyWage: 9_500,
    currency: 'SAR',
    permitExpiryOffsetDays: 7, // critical band
    residencyPermitType: 'iqama',
    preferredLanguage: 'ar',
    isFieldWorker: true,
    isHrStaff: false,
  },
  {
    id: 'E-1004',
    firstName: 'Rajesh',
    lastName: 'Kumar',
    displayName: 'Rajesh Kumar',
    workEmail: 'rajesh.kumar@example.com',
    mobilePhone: '+966501234004',
    hireDate: '2021-09-01',
    country: 'SA',
    department: 'Logistics',
    division: 'Industrial Services',
    location: 'Yanbu',
    jobTitle: 'Warehouse Coordinator',
    supervisorId: 'M-2001',
    supervisorName: 'Khalid Al-Dossari',
    supervisorEmail: 'khalid.aldossari@example.com',
    employmentStatus: 'active',
    monthlyWage: 7_200,
    currency: 'SAR',
    permitExpiryOffsetDays: -27, // already expired: the case nobody should reach
    residencyPermitType: 'iqama',
    preferredLanguage: 'en',
    isFieldWorker: true,
    isHrStaff: false,
  },
  {
    id: 'E-1005',
    firstName: 'Sara',
    lastName: 'Al-Mansouri',
    displayName: 'Sara Al-Mansouri',
    displayNameAr: 'سارة المنصوري',
    workEmail: 'sara.almansouri@example.com',
    mobilePhone: '+971501234005',
    hireDate: '2024-02-01',
    country: 'AE',
    department: 'Commercial',
    division: 'Corporate',
    location: 'Dubai',
    jobTitle: 'Contracts Manager',
    supervisorId: 'M-2002',
    supervisorName: 'Reem Al-Harbi',
    supervisorEmail: 'reem.alharbi@example.com',
    employmentStatus: 'active',
    monthlyWage: 26_000,
    currency: 'AED',
    permitExpiryOffsetDays: 60, // warning band, Emirates ID rather than Iqama
    residencyPermitType: 'emirates_id',
    preferredLanguage: 'en',
    isFieldWorker: false,
    isHrStaff: false,
  },
  {
    id: 'E-1006',
    firstName: 'Omar',
    lastName: 'Khalil',
    displayName: 'Omar Khalil',
    displayNameAr: 'عمر خليل',
    workEmail: 'omar.khalil@example.com',
    mobilePhone: '+201001234006',
    hireDate: '2019-05-20',
    country: 'EG',
    department: 'Engineering',
    division: 'Corporate',
    location: 'Cairo',
    jobTitle: 'Process Engineer',
    supervisorId: 'M-2002',
    supervisorName: 'Reem Al-Harbi',
    supervisorEmail: 'reem.alharbi@example.com',
    employmentStatus: 'active',
    monthlyWage: 42_000,
    currency: 'EGP',
    preferredLanguage: 'ar',
    isFieldWorker: false,
    isHrStaff: false,
  },
  {
    id: 'E-1007',
    firstName: 'Lina',
    lastName: 'Haddad',
    displayName: 'Lina Haddad',
    displayNameAr: 'لينا حداد',
    workEmail: 'lina.haddad@example.com',
    mobilePhone: '+962791234007',
    hireDate: '2020-11-01',
    country: 'JO',
    department: 'Procurement',
    division: 'Corporate',
    location: 'Amman',
    jobTitle: 'Procurement Specialist',
    supervisorId: 'M-2002',
    supervisorName: 'Reem Al-Harbi',
    supervisorEmail: 'reem.alharbi@example.com',
    employmentStatus: 'active',
    monthlyWage: 1_400,
    currency: 'JOD',
    preferredLanguage: 'en',
    isFieldWorker: false,
    isHrStaff: false,
  },
  {
    id: 'M-2001',
    firstName: 'Khalid',
    lastName: 'Al-Dossari',
    displayName: 'Khalid Al-Dossari',
    displayNameAr: 'خالد الدوسري',
    workEmail: 'khalid.aldossari@example.com',
    mobilePhone: '+966501234100',
    hireDate: '2012-01-01',
    country: 'SA',
    department: 'Operations',
    division: 'Industrial Services',
    location: 'Riyadh',
    jobTitle: 'Operations Manager',
    supervisorId: 'H-3001',
    supervisorName: 'Noura Al-Qahtani',
    supervisorEmail: 'noura.alqahtani@example.com',
    employmentStatus: 'active',
    monthlyWage: 32_000,
    currency: 'SAR',
    permitExpiryOffsetDays: 400, // comfortably valid
    residencyPermitType: 'iqama',
    preferredLanguage: 'ar',
    isFieldWorker: false,
    isHrStaff: false,
  },
  {
    id: 'M-2002',
    firstName: 'Reem',
    lastName: 'Al-Harbi',
    displayName: 'Reem Al-Harbi',
    displayNameAr: 'ريم الحربي',
    workEmail: 'reem.alharbi@example.com',
    mobilePhone: '+966501234101',
    hireDate: '2016-04-15',
    country: 'SA',
    department: 'Corporate',
    division: 'Corporate',
    location: 'Riyadh',
    jobTitle: 'Corporate Services Director',
    supervisorId: 'H-3001',
    supervisorName: 'Noura Al-Qahtani',
    supervisorEmail: 'noura.alqahtani@example.com',
    employmentStatus: 'active',
    monthlyWage: 38_000,
    currency: 'SAR',
    preferredLanguage: 'en',
    isFieldWorker: false,
    isHrStaff: false,
  },
  {
    id: 'H-3001',
    firstName: 'Noura',
    lastName: 'Al-Qahtani',
    displayName: 'Noura Al-Qahtani',
    displayNameAr: 'نورة القحطاني',
    workEmail: 'noura.alqahtani@example.com',
    mobilePhone: '+966501234200',
    hireDate: '2014-09-01',
    country: 'SA',
    department: 'Human Resources',
    division: 'Corporate',
    location: 'Riyadh',
    jobTitle: 'HR Business Partner',
    supervisorId: '',
    supervisorName: '',
    supervisorEmail: '',
    employmentStatus: 'active',
    monthlyWage: 30_000,
    currency: 'SAR',
    preferredLanguage: 'ar',
    isFieldWorker: false,
    isHrStaff: true,
  },
];

/**
 * Pre-existing leave requests, so "show me my requests" has something to show
 * on a fresh clone. Dates are relative offsets for the same reason permit
 * expiries are.
 */
export interface SeedLeaveRequest extends Omit<LeaveRequest, 'startDate' | 'endDate' | 'createdAt'> {
  startOffsetDays: number;
  endOffsetDays: number;
  createdOffsetDays: number;
}

export const SEED_LEAVE_REQUESTS: SeedLeaveRequest[] = [
  {
    id: 'LR-5001',
    employeeId: 'E-1001',
    employeeName: 'Ahmad Al-Otaibi',
    leaveType: 'annual',
    days: 6,
    status: 'approved',
    notes: 'Family visit',
    startOffsetDays: -45,
    endOffsetDays: -40,
    createdOffsetDays: -60,
    decidedBy: 'M-2001',
    decisionNote: 'Approved, cover arranged with the night shift.',
  },
  {
    id: 'LR-5002',
    employeeId: 'E-1003',
    employeeName: 'Mohammed Hassan',
    leaveType: 'sick',
    days: 3,
    status: 'approved',
    notes: 'Medical certificate submitted',
    startOffsetDays: -20,
    endOffsetDays: -18,
    createdOffsetDays: -21,
    decidedBy: 'M-2001',
  },
  {
    id: 'LR-5003',
    employeeId: 'E-1002',
    employeeName: 'Fatima Al-Zahrani',
    leaveType: 'annual',
    days: 5,
    status: 'pending',
    notes: 'Eid break',
    startOffsetDays: 21,
    endOffsetDays: 25,
    createdOffsetDays: -2,
  },
];

/** Days of annual leave already consumed this leave year, by employee. */
export const SEED_USED_DAYS: Record<string, Partial<Record<string, number>>> = {
  'E-1001': { annual: 6, sick: 0, emergency: 1 },
  'E-1002': { annual: 4, sick: 2, emergency: 0 },
  'E-1003': { annual: 12, sick: 3, emergency: 0 },
  'E-1004': { annual: 0, sick: 0, emergency: 0 },
  'E-1005': { annual: 8, sick: 1, emergency: 0 },
  'E-1006': { annual: 10, sick: 0, emergency: 0 },
  'E-1007': { annual: 3, sick: 0, emergency: 0 },
  'M-2001': { annual: 15, sick: 0, emergency: 0 },
  'M-2002': { annual: 9, sick: 0, emergency: 0 },
  'H-3001': { annual: 7, sick: 0, emergency: 0 },
};

/** Carry-over from the previous leave year, where policy allowed it. */
export const SEED_CARRIED_OVER: Record<string, number> = {
  'E-1001': 5,
  'E-1003': 3,
};
