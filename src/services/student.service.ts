import { IStudent, StudentStatus } from '../types';
import StudentRepository from '../repositories/student.repository';
import SchoolRepository from '../repositories/school.repository';
import SessionRepository from '../repositories/session.repository';
import FeeStructureRepository from '../repositories/feeStructure.repository';
import StudentFeeRepository from '../repositories/studentFee.repository';
import TransportDestinationRepository from '../repositories/transportDestination.repository';
import ErrorResponse from '../utils/errorResponse';
import Student from '../models/student.model';
import StudentFee from '../models/studentFee.model';
import { getTenantFilter } from '../utils/tenant';
import { updateUsageForSchool } from './usage.service';
import { Types } from 'mongoose';
import { FeeStatus } from '../types';
import {
    buildStudentUsernameBase,
    ensureUniqueStudentUsername,
    isMongoDuplicateUsernameError,
    normalizeFirstNameForUsername,
} from '../utils/studentUsername';
import {
    getSessionYearMonths,
    normalizeFeeExemptMonths,
    countChargeableSessionMonths,
} from '../utils/feeExemptMonths';

class StudentService {
    private normalizeTransportFields<T extends Record<string, any>>(payload: T): T {
        const next: T = { ...payload };
        const rawUsesTransport = next.usesTransport;
        const usesTransport =
            rawUsesTransport === true ||
            rawUsesTransport === 'true' ||
            rawUsesTransport === 1 ||
            rawUsesTransport === '1';

        const rawDestination = next.transportDestinationId;
        const hasValidDestination = !!(
            typeof rawDestination === 'string'
                ? rawDestination.trim()
                : rawDestination
        );

        if (!usesTransport || !hasValidDestination) {
            (next as any).usesTransport = false;
            (next as any).transportDestinationId = undefined;
            (next as any).busId = undefined;
        } else {
            (next as any).usesTransport = true;
        }
        return next;
    }

    private async resolveTransportMonthlyFee(student: any): Promise<number> {
        if (!student?.usesTransport || !student?.transportDestinationId) return 0;
        const destination = await TransportDestinationRepository.findById(
            String(student.transportDestinationId)
        );
        return destination ? Number(destination.monthlyFee) || 0 : 0;
    }
    /**
     * Helper function to create fee ledger entries for a student
     */
    private async ensureStudentFeeLedger(schoolId: string, student: any, session: any, structure: any): Promise<void> {
        const rawItems: Array<{ title?: string; name?: string; amount: number; type?: string }> =
            (structure as any).components && (structure as any).components.length > 0
                ? (structure as any).components
                : ((structure as any).fees || []).map((f: any) => ({
                      title: f.title,
                      amount: f.amount,
                      type: f.type,
                  }));

        const monthlyItems = rawItems.filter((x: any) => (x.type || '').toString().toLowerCase() === 'monthly');
        const oneTimeItems = rawItems.filter((x: any) => {
            const t = (x.type || '').toString().toLowerCase();
            return t === 'one-time' || t === 'one_time' || t === 'one time';
        });

        // Add transport fee if student uses transport
        let transportMonthlyFee = 0;
        if (student.usesTransport && student.transportDestinationId) {
            const transportDestination = await TransportDestinationRepository.findById(student.transportDestinationId.toString());
            if (transportDestination) {
                transportMonthlyFee = transportDestination.monthlyFee || 0;
                // Add transport as a monthly item
                monthlyItems.push({
                    title: `Transport - ${transportDestination.destinationName}`,
                    amount: transportMonthlyFee,
                    type: 'monthly',
                });
            }
        }

        const monthlyTotal = monthlyItems.reduce((sum: number, x: any) => sum + (Number(x.amount) || 0), 0);
        const oneTimeTotal = oneTimeItems.reduce((sum: number, x: any) => sum + (Number(x.amount) || 0), 0);

        const months = getSessionYearMonths(session);
        const exemptCanon = normalizeFeeExemptMonths(
            (structure as any).feeExemptMonths,
            months.map((x) => x.monthName)
        );
        const chargeableCount = countChargeableSessionMonths(months, exemptCanon);
        if (chargeableCount <= 0) return;

        const annualRecurring = monthlyTotal * chargeableCount;
        const flatConcession = Math.max(0, Math.round(Number(student?.concessionAmount) || 0));
        const pctConcession = Math.min(100, Math.max(0, Number(student?.concessionPercent) || 0));
        const fromPct = pctConcession > 0 ? Math.round((annualRecurring * pctConcession) / 100) : 0;
        const concession = Math.min(annualRecurring, flatConcession + fromPct);

        const annualMonthlyAfter = concession > 0 && monthlyTotal > 0
            ? Math.max(0, annualRecurring - concession)
            : annualRecurring;

        const annualMonthlyAfterInt = Math.round(annualMonthlyAfter);
        const basePerMonth = chargeableCount > 0
            ? Math.floor(annualMonthlyAfterInt / chargeableCount)
            : annualMonthlyAfterInt;
        const remainder = chargeableCount > 0
            ? annualMonthlyAfterInt - (basePerMonth * chargeableCount)
            : 0;

        // Batch-fetch all existing fee rows for this student+session to avoid N+1 DB calls
        const existingFees = await StudentFee.find({
            schoolId: new Types.ObjectId(schoolId),
            studentId: student._id,
            sessionId: session._id,
        }).select('month').lean();
        const existingMonths = new Set(existingFees.map((f: any) => String(f.month)));

        let chargeableIdx = 0;
        for (const m of months) {
            if (existingMonths.has(m.monthName)) continue;

            if (exemptCanon.has(m.monthName)) {
                await StudentFeeRepository.create({
                    schoolId: new Types.ObjectId(schoolId) as any,
                    studentId: student._id,
                    sessionId: session._id,
                    month: m.monthName,
                    feeBreakdown: monthlyItems.map((f: any) => ({
                        title: f.title || f.name || 'Monthly Fee',
                        amount: 0,
                        type: 'monthly',
                    })),
                    totalAmount: 0,
                    paidAmount: 0,
                    remainingAmount: 0,
                    status: FeeStatus.EXEMPT,
                    dueDate: new Date(m.year, m.month, 0, 23, 59, 59),
                    payments: [],
                    discount: 0,
                    lateFee: 0,
                } as any);
                continue;
            }

            const adjustedMonthlyPerMonth = chargeableIdx < remainder ? basePerMonth + 1 : basePerMonth;
            chargeableIdx++;
            await StudentFeeRepository.create({
                schoolId: new Types.ObjectId(schoolId) as any,
                studentId: student._id,
                sessionId: session._id,
                month: m.monthName,
                feeBreakdown: monthlyItems.map((f: any) => ({
                    title: f.title || f.name || 'Monthly Fee',
                    amount: Number(f.amount) || 0,
                    type: 'monthly',
                })),
                totalAmount: adjustedMonthlyPerMonth,
                paidAmount: 0,
                remainingAmount: adjustedMonthlyPerMonth,
                status: FeeStatus.PENDING,
                dueDate: new Date(m.year, m.month, 0, 23, 59, 59),
                payments: [],
                discount: 0,
                lateFee: 0,
            } as any);
        }

        if (oneTimeTotal > 0) {
            if (!existingMonths.has('One-Time')) {
                await StudentFeeRepository.create({
                    schoolId: new Types.ObjectId(schoolId) as any,
                    studentId: student._id,
                    sessionId: session._id,
                    month: 'One-Time',
                    feeBreakdown: oneTimeItems.map((f: any) => ({
                        title: f.title || f.name || 'One-Time Fee',
                        amount: Number(f.amount) || 0,
                        type: 'one-time',
                    })),
                    totalAmount: oneTimeTotal,
                    paidAmount: 0,
                    remainingAmount: oneTimeTotal,
                    status: FeeStatus.PENDING,
                    dueDate: new Date(session.startDate),
                    payments: [],
                    discount: 0,
                    lateFee: 0,
                } as any);
            }
        }
    }

    /**
     * Create a new student with auto-generated admission number
     */
    async createStudent(schoolId: string, studentData: Partial<IStudent>): Promise<IStudent> {
        const normalizedStudentData = this.normalizeTransportFields(studentData as any) as Partial<IStudent>;
        const activeSession = await SessionRepository.findActive(schoolId);
        if (!activeSession) {
            throw new ErrorResponse('No active session found. Please create a session first.', 400);
        }

        const school = await SchoolRepository.findById(schoolId);
        if (!school) {
            throw new ErrorResponse('School not found', 404);
        }

        // Use manual admission number if provided, otherwise auto-generate
        let admissionNumber: string;
        if (normalizedStudentData.admissionNumber && normalizedStudentData.admissionNumber.trim()) {
            admissionNumber = normalizedStudentData.admissionNumber.trim().toUpperCase();
        } else {
            admissionNumber = await this.generateAdmissionNumber(schoolId, school.schoolCode);
        }

        // Default password = DOB as DDMMYYYY (e.g. 15082010)
        let defaultPassword = admissionNumber; // fallback
        if (normalizedStudentData.dateOfBirth) {
            const dob = new Date(normalizedStudentData.dateOfBirth);
            const dd = String(dob.getDate()).padStart(2, '0');
            const mm = String(dob.getMonth() + 1).padStart(2, '0');
            const yyyy = dob.getFullYear();
            defaultPassword = `${dd}${mm}${yyyy}`;
        }

        const namePart = normalizeFirstNameForUsername(normalizedStudentData.firstName || '');
        if (!namePart) {
            throw new ErrorResponse(
                'First name must contain at least one letter or number for username generation',
                400
            );
        }

        const phoneDigits = (normalizedStudentData.phone || '').replace(/\D/g, '');
        if (phoneDigits.length === 0) {
            throw new ErrorResponse(
                'Phone number must contain at least one digit (used for login username)',
                400
            );
        }

        const baseUsername = buildStudentUsernameBase(
            normalizedStudentData.firstName || '',
            normalizedStudentData.phone,
            admissionNumber
        );

        let lastError: unknown;
        for (let attempt = 0; attempt < 12; attempt++) {
            const username = await ensureUniqueStudentUsername(baseUsername);
            try {
                const student = await StudentRepository.create({
                    ...normalizedStudentData,
                    schoolId: school._id,
                    sessionId: activeSession._id,
                    admissionNumber,
                    username,
                    status: StudentStatus.ACTIVE,
                    isActive: true,
                    password: defaultPassword,
                    plainPassword: defaultPassword,
                    mustChangePassword: true,
                } as any);

                // Set totalYearlyFee from fee structure if available and create fee ledger entries
                if (student.class) {
                    const structure = await FeeStructureRepository.findByClass(
                        schoolId,
                        activeSession._id.toString(),
                        student.class
                    );
                    if (structure) {
                        const rawItems: Array<{ amount: number; type?: string }> =
                            (structure as any).components && (structure as any).components.length > 0
                                ? (structure as any).components
                                : ((structure as any).fees || []).map((f: any) => ({
                                      amount: f.amount,
                                      type: f.type,
                                  }));

                        let monthlyTotal = 0;
                        let oneTimeTotal = 0;
                        for (const item of rawItems) {
                            if (!item || typeof item.amount !== 'number') continue;
                            const t = (item.type || '').toString().toLowerCase();
                            if (t === 'one-time' || t === 'one_time' || t === 'one time') {
                                oneTimeTotal += item.amount;
                            } else if (t === 'monthly') {
                                monthlyTotal += item.amount;
                            }
                        }

                        const transportMonthlyFee = await this.resolveTransportMonthlyFee(student);
                        monthlyTotal += transportMonthlyFee;

                        const sessionMonthsList = getSessionYearMonths(activeSession);
                        const exemptCanon = normalizeFeeExemptMonths(
                            (structure as any).feeExemptMonths,
                            sessionMonthsList.map((m) => m.monthName)
                        );
                        const chargeableCount = Math.max(
                            1,
                            countChargeableSessionMonths(sessionMonthsList, exemptCanon)
                        );
                        const annualRecurring = monthlyTotal * chargeableCount;
                        const totalYearly = annualRecurring + oneTimeTotal;

                        await StudentRepository.update(student._id.toString(), {
                            totalYearlyFee: totalYearly,
                            dueAmount: totalYearly,
                            paidAmount: 0,
                        } as any);

                        await this.ensureStudentFeeLedger(schoolId, student, activeSession, structure);
                    }
                }

                await updateUsageForSchool(schoolId);
                return student;
            } catch (err) {
                lastError = err;
                if (isMongoDuplicateUsernameError(err)) {
                    await new Promise((r) => setImmediate(r));
                    continue;
                }
                throw err;
            }
        }

        throw lastError instanceof Error
            ? lastError
            : new ErrorResponse('Could not assign a unique username. Try again.', 409);
    }

    /**
     * List students with pagination and filters
     */
    async listStudents(
        schoolId: string,
        query: { page?: number; limit?: number; search?: string; class?: string; section?: string; status?: string }
    ): Promise<{ students: IStudent[]; total: number; pages: number }> {
        const page = query.page || 1;
        const limit = query.limit || 50;
        const skip = (page - 1) * limit;

        // Standardized Tenant Filtering
        let filter = getTenantFilter(schoolId);

        if (query.class) filter.class = query.class;
        if (query.section) filter.section = query.section.toUpperCase();
        if (query.status) filter.status = query.status;

        if (query.search) {
            filter.$or = [
                { firstName: { $regex: query.search, $options: 'i' } },
                { lastName: { $regex: query.search, $options: 'i' } },
                { admissionNumber: { $regex: query.search, $options: 'i' } },
            ];
        }

        const [result, total] = await Promise.all([
            Student.find(filter)
                .sort({ class: 1, section: 1, rollNumber: 1 })
                .skip(skip)
                .limit(limit)
                .lean().exec() as unknown as IStudent[],
            Student.countDocuments(filter),
        ]);

        return {
            students: result,
            total,
            pages: Math.ceil(total / limit),
        };
    }

    /**
     * Get student by ID
     */
    async getStudent(schoolId: string, id: string): Promise<IStudent> {
        const filter = getTenantFilter(schoolId, { _id: id });
        const student = await Student.findOne(filter)
            .populate(
                'busId',
                'routeName busNumber registrationNumber driverName driverPhone conductorName conductorPhone isActive'
            )
            .exec();
        if (!student) {
            throw new ErrorResponse('Student not found', 404);
        }
        return student as IStudent;
    }

    /**
     * Update student
     */
    async updateStudent(schoolId: string, id: string, data: Partial<IStudent>): Promise<IStudent> {
        const normalizedData = this.normalizeTransportFields(data as any) as Partial<IStudent>;
        const filter = getTenantFilter(schoolId, { _id: id });
        const student = await StudentRepository.findOne(filter);
        if (!student) {
            throw new ErrorResponse('Student not found', 404);
        }

        const updatedStudent = await StudentRepository.update(id, normalizedData);
        if (!updatedStudent) {
            throw new ErrorResponse('Student not found', 404);
        }

        // Keep yearly total / due in sync when fee-impacting fields change.
        const feeFieldsChanged = [
            'class',
            'usesTransport',
            'transportDestinationId',
            'concessionAmount',
            'concessionPercent',
        ].some((k) => Object.prototype.hasOwnProperty.call(normalizedData, k));

        if (feeFieldsChanged && updatedStudent.class) {
            const activeSession = await SessionRepository.findActive(schoolId);
            if (activeSession) {
                let structure = await FeeStructureRepository.findByClass(
                    schoolId,
                    activeSession._id.toString(),
                    updatedStudent.class
                );
                if (!structure && typeof updatedStudent.class === 'string' && updatedStudent.class.includes(' ')) {
                    structure = await FeeStructureRepository.findByClass(
                        schoolId,
                        activeSession._id.toString(),
                        updatedStudent.class.split(' ')[0]
                    );
                }
                if (structure) {
                    const rawItems: Array<{ amount: number; type?: string }> =
                        (structure as any).components && (structure as any).components.length > 0
                            ? (structure as any).components
                            : ((structure as any).fees || []).map((f: any) => ({
                                  amount: f.amount,
                                  type: f.type,
                              }));

                    let monthlyTotal = 0;
                    let oneTimeTotal = 0;
                    for (const item of rawItems) {
                        if (!item || typeof item.amount !== 'number') continue;
                        const t = (item.type || '').toString().toLowerCase();
                        if (t === 'one-time' || t === 'one_time' || t === 'one time') oneTimeTotal += item.amount;
                        else if (t === 'monthly') monthlyTotal += item.amount;
                    }

                    const transportMonthlyFee = await this.resolveTransportMonthlyFee(updatedStudent);
                    monthlyTotal += transportMonthlyFee;

                    const sessionMonthsList = getSessionYearMonths(activeSession);
                    const exemptCanon = normalizeFeeExemptMonths(
                        (structure as any).feeExemptMonths,
                        sessionMonthsList.map((m) => m.monthName)
                    );
                    const chargeableCount = Math.max(
                        1,
                        countChargeableSessionMonths(sessionMonthsList, exemptCanon)
                    );
                    const annualRecurring = monthlyTotal * chargeableCount;
                    const flatConcession = Math.max(0, Math.round(Number((updatedStudent as any).concessionAmount) || 0));
                    const pctConcession = Math.min(
                        100,
                        Math.max(0, Number((updatedStudent as any).concessionPercent) || 0)
                    );
                    const fromPct = pctConcession > 0 ? Math.round((annualRecurring * pctConcession) / 100) : 0;
                    const concession = Math.min(annualRecurring, flatConcession + fromPct);
                    const adjustedAnnualRecurring = Math.max(0, annualRecurring - concession);

                    const totalYearlyFee = adjustedAnnualRecurring + oneTimeTotal;
                    const paidAmount = Number((updatedStudent as any).paidAmount) || 0;
                    const dueAmount = Math.max(0, totalYearlyFee - paidAmount);

                    await StudentRepository.update(id, {
                        totalYearlyFee,
                        dueAmount,
                    } as any);
                }
            }
        }
        return (await StudentRepository.findById(id)) as IStudent;
    }

    /**
     * Delete student
     * NOTE: cascade cleanup is handled in CascadeDeleteService.
     */
    async deleteStudent(schoolId: string, id: string): Promise<void> {
        const filter = getTenantFilter(schoolId, { _id: id });
        const student = await StudentRepository.findOne(filter);
        if (!student) {
            throw new ErrorResponse('Student not found', 404);
        }

        await StudentRepository.delete(id);

        await updateUsageForSchool(schoolId);
    }

    /**
     * Generate Admission Number: {SCHOOL_CODE}{YY}{SEQUENCE}
     * e.g., DPS240001
     */
    private async generateAdmissionNumber(schoolId: string, schoolCode: string): Promise<string> {
        const year = new Date().getFullYear().toString().slice(-2);
        const prefix = `${schoolCode}${year}`;

        const lastStudent = await Student.findOne({
            schoolId,
            admissionNumber: { $regex: `^${prefix}`, $options: 'i' },
        }).sort({ admissionNumber: -1 });

        let sequence = 1;
        if (lastStudent) {
            const lastSequenceStr = lastStudent.admissionNumber.slice(prefix.length);
            const lastSequence = parseInt(lastSequenceStr, 10);
            if (!isNaN(lastSequence)) {
                sequence = lastSequence + 1;
            }
        }

        return `${prefix}${sequence.toString().padStart(4, '0')}`;
    }

    /**
     * Get student counts by class
     */
    async getStudentCountsByClass(schoolId: string): Promise<{ class: string; count: number }[]> {
        const schoolObjId = new Types.ObjectId(schoolId);
        const result = await Student.aggregate([
            { $match: { schoolId: schoolObjId } },
            { $group: { _id: '$class', count: { $sum: 1 } } },
            { $sort: { _id: 1 } },
            { $project: { class: '$_id', count: 1, _id: 0 } },
        ]);
        console.log("Student counts by class result:", result);
        return result;
    }
}

export default new StudentService();
