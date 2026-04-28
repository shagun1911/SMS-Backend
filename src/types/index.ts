import { Request } from 'express';
import { Document, Types } from 'mongoose';

// ============================================
// USER & AUTHENTICATION TYPES
// ============================================

export enum UserRole {
    SUPER_ADMIN = 'superadmin',
    SCHOOL_ADMIN = 'schooladmin',
    TEACHER = 'teacher',
    ACCOUNTANT = 'accountant',
    TRANSPORT_MANAGER = 'transport_manager',
    BUS_DRIVER = 'bus_driver',
    CONDUCTOR = 'conductor',
    CLEANING_STAFF = 'cleaning_staff',
    /** Use with `staffRoleTitle` for a custom job title. */
    STAFF_OTHER = 'staff_other',
}

export interface IUser extends Document {
    _id: Types.ObjectId;
    schoolId?: Types.ObjectId;
    name: string;
    /** Required for super admin; optional for school staff (login uses `username` = phone). */
    email?: string;
    /** Normalized digits; unique globally; school staff login identifier. */
    username?: string;
    password: string;
    plainPassword?: string;
    /** Required for school staff; optional for super admin (email-only master login). */
    phone?: string;
    role: UserRole;
    photo?: string;
    /** When `role` is `staff_other`, label shown in directory and payroll. */
    staffRoleTitle?: string;
    subject?: string;
    qualification?: string;
    joiningDate?: Date;
    baseSalary?: number;
    totalAbsentCount?: number;
    salary?: number;
    bankDetails?: {
        accountNumber: string;
        ifscCode: string;
        bankName: string;
        branchName: string;
    };
    isActive: boolean;
    seenNotificationIds?: string[];
    lastLogin?: Date;
    mustChangePassword?: boolean;
    permissions?: string[];
    refreshToken?: string;
    refreshTokens?: string[];
    /** FCM registration tokens for this staff user (multiple devices). */
    fcmTokens?: string[];
    createdAt: Date;
    updatedAt: Date;
    matchPassword(enteredPassword: string): Promise<boolean>;
}

export interface IAuthTokens {
    accessToken: string;
    refreshToken: string;
}

export interface ITokenPayload {
    id: string;
    email: string;
    role: UserRole;
    schoolId?: string;
}

// ============================================
// REQUEST EXTENSIONS
// ============================================

export interface AuthRequest extends Request {
    user?: IUser;
    student?: IStudent;
    schoolId?: string;
}

// ============================================
// SCHOOL TYPES
// ============================================

export enum SubscriptionPlan {
    FREE = 'free',
    PRO = 'pro',
    ENTERPRISE = 'enterprise',
}

export enum Board {
    CBSE = 'CBSE',
    ICSE = 'ICSE',
    RBSE = 'RBSE',
    STATE_BOARD = 'State Board',
    IB = 'IB',
    OTHER = 'Other',
}

export interface ISchool extends Document {
    _id: Types.ObjectId;
    schoolName: string;
    schoolCode: string;
    logo?: string;
    stamp?: string;
    principalSignature?: string;
    email: string;
    phone: string;
    address: {
        street: string;
        city: string;
        state: string;
        pincode: string;
        country: string;
    };
    principalName: string;
    board: Board;
    classRange: {
        from: string;
        to: string;
    };
    sessionStartMonth: string;
    subscriptionPlan: SubscriptionPlan;
    subscriptionExpiry?: Date;
    studentLimit: number;
    isActive: boolean;
    settings: {
        currency: string;
        dateFormat: string;
        timezone: string;
    };
    adminUserId: Types.ObjectId;
    createdAt: Date;
    updatedAt: Date;
}

// ============================================
// STUDENT TYPES
// ============================================

export enum Gender {
    MALE = 'Male',
    FEMALE = 'Female',
    OTHER = 'Other',
}

export enum BloodGroup {
    A_POSITIVE = 'A+',
    A_NEGATIVE = 'A-',
    B_POSITIVE = 'B+',
    B_NEGATIVE = 'B-',
    AB_POSITIVE = 'AB+',
    AB_NEGATIVE = 'AB-',
    O_POSITIVE = 'O+',
    O_NEGATIVE = 'O-',
}

export enum StudentStatus {
    ACTIVE = 'active',
    PROMOTED = 'promoted',
    ALUMNI = 'alumni',
    TRANSFERRED = 'transferred',
    DISCONTINUED = 'discontinued',
    PASSED_OUT = 'passed_out',
}

export interface IStudent extends Document {
    _id: Types.ObjectId;
    schoolId: Types.ObjectId;
    admissionNumber: string;
    username?: string;
    sessionId: Types.ObjectId;
    firstName: string;
    lastName: string;
    fatherName: string;
    motherName: string;
    dateOfBirth: Date;
    gender: Gender;
    bloodGroup?: BloodGroup;
    photo?: string;
    address: {
        street: string;
        city: string;
        state: string;
        pincode: string;
    };
    phone: string;
    alternatePhone?: string;
    email?: string;
    class: string;
    section: string;
    rollNumber?: number;
    admissionDate: Date;
    previousSchool?: string;
    tcSubmitted: boolean;
    tcDocument?: string;
    migrationSubmitted: boolean;
    migrationDocument?: string;
    birthCertificate?: string;
    status: StudentStatus;
    isActive: boolean;
    seenNotificationIds?: string[];
    usesTransport: boolean;
    transportDestinationId?: Types.ObjectId;
    busId?: Types.ObjectId;
    totalYearlyFee?: number;
    paidAmount?: number;
    dueAmount?: number;
    concessionAmount?: number;
    /** 0–100; discount on annual recurring (monthly) fees only, not one-time admission items. */
    concessionPercent?: number;
    initialDepositAmount?: number;
    depositPaymentMode?: string;
    depositDate?: Date;
    depositTransactionId?: string;
    // Auth fields
    password?: string;
    plainPassword?: string;
    mustChangePassword?: boolean;
    lastLogin?: Date;
    /** FCM registration tokens for this student (multiple devices). */
    fcmTokens?: string[];
    createdAt: Date;
    updatedAt: Date;
    // Methods
    matchPassword(enteredPassword: string): Promise<boolean>;
    getSignedJwtToken(): string;
}

// ============================================
// FEE TYPES
// ============================================

export enum FeeType {
    ONE_TIME = 'one-time',
    MONTHLY = 'monthly',
    QUARTERLY = 'quarterly',
    HALF_YEARLY = 'half-yearly',
    YEARLY = 'yearly',
}

export enum FeeStatus {
    PENDING = 'pending',
    PARTIAL = 'partial',
    PAID = 'paid',
    OVERDUE = 'overdue',
    /** Monthly fee row: session month marked fee-exempt in structure (no charge). */
    EXEMPT = 'exempt',
}

export enum PaymentMode {
    CASH = 'cash',
    CHEQUE = 'cheque',
    ONLINE = 'online',
    UPI = 'upi',
    CARD = 'card',
    BANK = 'bank',
}

export interface IFeeStructure extends Document {
    _id: Types.ObjectId;
    schoolId: Types.ObjectId;
    sessionId: Types.ObjectId;
    classId?: Types.ObjectId;
    class: string; // className e.g. "8th A"
    fees?: Array<{
        title: string;
        type: FeeType;
        amount: number;
        description?: string;
        isOptional: boolean;
    }>;
    components?: Array<{ name: string; amount: number; type?: 'monthly' | 'one-time' }>;
    /** Full English month names within the session where monthly (incl. transport) fee is not charged. */
    feeExemptMonths?: string[];
    /** When set (>0), recurring annual = sum(monthly components) × this; otherwise legacy ×12. */
    monthlyMultiplier?: number | null;
    totalAnnualFee?: number;
    totalAmount?: number;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
}

export interface IReceiptCounter extends Document {
    _id: Types.ObjectId;
    schoolId: Types.ObjectId;
    year: number;
    seq: number;
    createdAt: Date;
    updatedAt: Date;
}

export interface IFeePayment extends Document {
    _id: Types.ObjectId;
    schoolId: Types.ObjectId;
    studentId: Types.ObjectId;
    classId?: Types.ObjectId;
    receiptNumber: string;
    amountPaid: number;
    paymentMode: string;
    paymentDate: Date;
    previousDue: number;
    remainingDue: number;
    pdfPath?: string;
    transactionId?: string;
    createdAt: Date;
    updatedAt: Date;
}

export interface IStudentFee extends Document {
    _id: Types.ObjectId;
    schoolId: Types.ObjectId;
    studentId: Types.ObjectId;
    sessionId: Types.ObjectId;
    month: string;
    feeBreakdown: Array<{
        title: string;
        amount: number;
        type: string;
    }>;
    totalAmount: number;
    paidAmount: number;
    remainingAmount: number;
    status: FeeStatus;
    dueDate: Date;
    payments: Array<{
        amount: number;
        paymentDate: Date;
        paymentMode: PaymentMode;
        transactionId?: string;
        receiptNumber?: string;
        receivedBy: Types.ObjectId;
        remarks?: string;
    }>;
    discount: number;
    discountReason?: string;
    lateFee: number;
    createdAt: Date;
    updatedAt: Date;
}

// ============================================
// SESSION TYPES
// ============================================

export interface ISession extends Document {
    _id: Types.ObjectId;
    schoolId: Types.ObjectId;
    sessionYear: string;
    startDate: Date;
    endDate: Date;
    isActive: boolean;
    promotionCompleted: boolean;
    promotionDate?: Date;
    createdAt: Date;
    updatedAt: Date;
}

// ============================================
// SALARY TYPES
// ============================================

export enum SalaryStatus {
    PENDING = 'pending',
    PARTIAL = 'partial',
    PAID = 'paid',
    HOLD = 'hold',
}

export interface ISalaryRecord extends Document {
    _id: Types.ObjectId;
    schoolId: Types.ObjectId;
    staffId: Types.ObjectId;
    month: string; // e.g., "April-2024"
    year: number;
    basicSalary: number;
    allowances: {
        title: string;
        amount: number;
    }[];
    deductions: {
        title: string;
        amount: number;
    }[];
    totalSalary: number;
    netSalary: number;
    paidAmount: number;
    status: SalaryStatus;
    paymentDate?: Date;
    paymentMode?: PaymentMode;
    paymentHistory?: {
        amount: number;
        paymentDate: Date;
        paymentMode: PaymentMode;
        transactionId?: string;
        remarks?: string;
    }[];
    transactionId?: string;
    remarks?: string;
    createdAt: Date;
    updatedAt: Date;
}

export interface ISalaryStructure extends Document {
    _id: Types.ObjectId;
    schoolId: Types.ObjectId;
    staffId: Types.ObjectId;
    baseSalary: number;
    allowances: {
        title: string;
        amount: number;
    }[];
    deductions: {
        title: string;
        amount: number;
    }[];
    effectiveFrom?: Date;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
}

export interface IOtherPayment extends Document {
    _id: Types.ObjectId;
    schoolId: Types.ObjectId;
    staffId: Types.ObjectId;
    title: string;
    amount: number;
    type: 'bonus' | 'adjustment';
    date: Date;
    notes?: string;
    isSettled?: boolean;
    createdAt: Date;
    updatedAt: Date;
}

// ============================================
// API RESPONSE TYPES
// ============================================

export interface IApiResponse<T = any> {
    success: boolean;
    message: string;
    data?: T;
    error?: string;
    meta?: {
        page?: number;
        limit?: number;
        total?: number;
        pages?: number;
    };
}

export interface IPaginationQuery {
    page?: number;
    limit?: number;
    search?: string;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
}

// ============================================
// SERVICE RESPONSE TYPES
// ============================================

export interface IServiceResponse<T = any> {
    success: boolean;
    data?: T;
    error?: string;
    statusCode?: number;
}

// ============================================
// ADMISSION ENQUIRY TYPES
// ============================================

export enum EnquiryStatus {
    PENDING = 'pending',
    FOLLOW_UP = 'follow_up',
    CONVERTED = 'converted',
    REJECTED = 'rejected',
}

export interface IAdmissionEnquiry extends Document {
    _id: Types.ObjectId;
    schoolId: Types.ObjectId;
    studentName: string;
    fatherName: string;
    motherName: string;
    dateOfBirth?: Date;
    gender?: Gender;
    class: string;
    section?: string;
    phone: string;
    alternatePhone?: string;
    email?: string;
    address: {
        street: string;
        city: string;
        state: string;
        pincode: string;
    };
    enquiryDate: Date;
    status: EnquiryStatus;
    followUpDate?: Date;
    notes?: string;
    referredBy?: string;
    previousSchool?: string;
    createdAt: Date;
    updatedAt: Date;
}
