import { ISalaryRecord, SalaryStatus, UserRole, PaymentMode, ISalaryStructure, IOtherPayment } from '../types';
import SalaryRepository from '../repositories/salary.repository';
import UserRepository from '../repositories/user.repository';
import SalaryStructureRepository from '../repositories/salaryStructure.repository';
import OtherPaymentRepository from '../repositories/otherPayment.repository';
import ErrorResponse from '../utils/errorResponse';
import { Types } from 'mongoose';
import UserNotification from '../models/userNotification.model';

class SalaryService {
    private getPayrollPeriodBounds(month: string, year: number): {
        startOfMonthUtc: Date;
        endOfMonthUtc: Date;
    } {
        const parsedYear = Number(year);
        if (!Number.isInteger(parsedYear) || parsedYear < 1900 || parsedYear > 9999) {
            throw new ErrorResponse('Invalid payroll year', 400);
        }

        const monthIndex = new Date(`${month} 1, ${parsedYear}`).getMonth();
        if (!Number.isInteger(monthIndex) || monthIndex < 0 || monthIndex > 11) {
            throw new ErrorResponse('Invalid payroll month', 400);
        }

        // UTC boundaries avoid local-time timezone drift in DB comparisons.
        const startOfMonthUtc = new Date(Date.UTC(parsedYear, monthIndex, 1, 0, 0, 0, 0));
        const endOfMonthUtc = new Date(Date.UTC(parsedYear, monthIndex + 1, 0, 23, 59, 59, 999));

        return { startOfMonthUtc, endOfMonthUtc };
    }

    private async buildMonthlySalaryComponents(
        schoolId: string,
        staffId: string,
        month: string,
        year: number
    ): Promise<{
        basicSalary: number;
        allowances: { title: string; amount: number }[];
        deductions: { title: string; amount: number }[];
        totalSalary: number;
        netSalary: number;
    }> {
        const [structure, staff] = await Promise.all([
            SalaryStructureRepository.findActiveByStaff(schoolId, staffId),
            UserRepository.findById(staffId),
        ]);

        if (!staff || staff.schoolId?.toString() !== schoolId) {
            throw new ErrorResponse('Staff member not found', 404);
        }

        const basicSalary = structure?.baseSalary ?? staff.baseSalary ?? 0;
        const allowances = [...(structure?.allowances || [])];
        const deductions = [...(structure?.deductions || [])];

        const { startOfMonthUtc, endOfMonthUtc } = this.getPayrollPeriodBounds(month, year);

        const otherPayments = await OtherPaymentRepository.findByStaffAndDateRange(
            schoolId,
            staffId,
            startOfMonthUtc,
            endOfMonthUtc
        );

        for (const payment of otherPayments) {
            const entry = {
                title: payment.title,
                amount: payment.amount,
            };

            if (payment.type === 'bonus') {
                allowances.push(entry);
            } else {
                deductions.push(entry);
            }
        }

        const allowanceTotal = allowances.reduce((acc, curr) => acc + curr.amount, 0);
        const deductionTotal = deductions.reduce((acc, curr) => acc + curr.amount, 0);
        const totalSalary = basicSalary + allowanceTotal;
        const netSalary = totalSalary - deductionTotal;

        return {
            basicSalary,
            allowances,
            deductions,
            totalSalary,
            netSalary,
        };
    }

    /**
     * List salary records for a school (payroll run view) with optional filters.
     * Populates staff name + role.
     */
    async listSchoolSalaries(
        schoolId: string,
        opts: { month?: string; year?: number; status?: string }
    ): Promise<any[]> {
        const filter: any = { schoolId };
        if (opts.month) filter.month = opts.month;
        if (opts.year) filter.year = opts.year;
        if (opts.status) filter.status = opts.status;

        const Salary = (await import('../models/salary.model')).default;
        const records = await Salary.find(filter)
            .populate('staffId', 'name email role')
            .sort({ createdAt: -1 })
            .lean();
        const filtered = records.filter((r: any) => r.staffId?.role !== UserRole.SCHOOL_ADMIN);

        const enriched = await Promise.all(
            filtered.map(async (r: any) => {
                const { startOfMonthUtc, endOfMonthUtc } = this.getPayrollPeriodBounds(r.month, r.year);

                const settled = await OtherPaymentRepository.findSettledByStaffAndDateRange(
                    schoolId,
                    String(r.staffId?._id ?? r.staffId),
                    startOfMonthUtc,
                    endOfMonthUtc
                );

                const settledBonusTotal = settled
                    .filter((p: any) => p.type === 'bonus')
                    .reduce((sum: number, p: any) => sum + (p.amount || 0), 0);
                const settledAdjustmentTotal = settled
                    .filter((p: any) => p.type === 'adjustment')
                    .reduce((sum: number, p: any) => sum + (p.amount || 0), 0);

                return {
                    ...r,
                    settledOtherPayments: settled,
                    settledBonusTotal,
                    settledAdjustmentTotal,
                    settledExtraNet: settledBonusTotal - settledAdjustmentTotal,
                };
            })
        );

        return enriched;
    }

    /**
     * Summary stats for a month's payroll run.
     */
    async getPayrollSummary(
        schoolId: string,
        opts: { month?: string; year?: number }
    ): Promise<{
        totalRecords: number;
        pendingCount: number;
        paidCount: number;
        holdCount: number;
        partialCount: number;
        totalNetAmount: number;
        totalPendingAmount: number;
        totalPaidAmount: number;
    }> {
        const filter: any = { schoolId };
        if (opts.month) filter.month = opts.month;
        if (opts.year) filter.year = opts.year;

        const Salary = (await import('../models/salary.model')).default;
        const records = await Salary.find(filter).lean();
        let pendingCount = 0, paidCount = 0, holdCount = 0, partialCount = 0;
        let totalNetAmount = 0, totalPendingAmount = 0, totalPaidAmount = 0;
        for (const r of records as any[]) {
            totalNetAmount += r.netSalary || 0;
            const paid = r.paidAmount || 0;
            totalPaidAmount += paid;
            if (r.status === 'paid') { paidCount++; }
            else if (r.status === 'hold') { holdCount++; totalPendingAmount += (r.netSalary || 0) - paid; }
            else if (r.status === 'partial') { partialCount++; totalPendingAmount += (r.netSalary || 0) - paid; }
            else { pendingCount++; totalPendingAmount += (r.netSalary || 0) - paid; }
        }
        return { totalRecords: records.length, pendingCount, paidCount, holdCount, partialCount, totalNetAmount, totalPendingAmount, totalPaidAmount };
    }

    /**
     * Get active salary structure for a staff member
     */
    async getSalaryStructure(
        schoolId: string,
        staffId: string
    ): Promise<ISalaryStructure | null> {
        // Try to get an explicit salary structure first
        const existing = await SalaryStructureRepository.findActiveByStaff(schoolId, staffId);
        if (existing) return existing;

        // Fallback: if no structure exists yet, surface the staff's baseSalary
        // so UI screens (Salary Structure / Manage Payroll) can still show
        // the configured base salary instead of 0.
        const staff = await UserRepository.findById(staffId);
        if (!staff || staff.schoolId?.toString() !== schoolId) {
            return null;
        }

        const baseSalary = staff.baseSalary ?? 0;

        // If base salary is zero or not set, behave as "no structure"
        if (!baseSalary) {
            return null;
        }

        return {
            // These casts are safe for read-only usage in service/controller responses
            _id: new Types.ObjectId() as any,
            schoolId: staff.schoolId as any,
            staffId: staff._id as any,
            baseSalary,
            allowances: [],
            deductions: [],
            effectiveFrom: undefined,
            isActive: true,
            createdAt: staff.createdAt || new Date(),
            updatedAt: staff.updatedAt || new Date(),
        } as unknown as ISalaryStructure;
    }

    /**
     * Create or update salary structure for a staff member
     */
    async upsertSalaryStructure(
        schoolId: string,
        staffId: string,
        payload: {
            baseSalary: number;
            allowances?: { title: string; amount: number }[];
            deductions?: { title: string; amount: number }[];
            effectiveFrom?: Date;
        }
    ): Promise<ISalaryStructure> {
        const existing = await SalaryStructureRepository.findActiveByStaff(schoolId, staffId);

        const data = {
            schoolId: new Types.ObjectId(schoolId) as any,
            staffId: new Types.ObjectId(staffId) as any,
            baseSalary: payload.baseSalary,
            allowances: payload.allowances || [],
            deductions: payload.deductions || [],
            effectiveFrom: payload.effectiveFrom,
            isActive: true,
        };

        if (!existing) {
            return await SalaryStructureRepository.create(data as any);
        }

        // For now, update in-place; if you later want history, you can deactivate old and create new.
        const updated = await SalaryStructureRepository.update(existing._id.toString(), data as any);
        return updated || (await SalaryStructureRepository.findById(existing._id.toString()))!;
    }

    /**
     * Generate Monthly Salaries for All Staff
     */
    async generateMonthlySalaries(
        schoolId: string,
        month: string,
        year: number,
        specificStaffId?: string
    ): Promise<{ created: number; updated: number; skipped: number; includedStaffIds: string[] }> {
        const { endOfMonthUtc } = this.getPayrollPeriodBounds(month, year);

        // 1. Get payroll-eligible active staff at query level:
        // joiningDate must be on/before payroll month end.
        const staff = await UserRepository.find({
            schoolId,
            isActive: true,
            role: {
                $in: [
                    UserRole.TEACHER,
                    UserRole.ACCOUNTANT,
                    UserRole.TRANSPORT_MANAGER,
                    UserRole.BUS_DRIVER,
                    UserRole.CONDUCTOR,
                    UserRole.CLEANING_STAFF,
                    UserRole.STAFF_OTHER,
                ],
            },
            joiningDate: { $lte: endOfMonthUtc },
            ...(specificStaffId && { _id: specificStaffId })
        });

        let createdCount = 0;
        let updatedCount = 0;
        let skippedCount = 0;
        const includedStaffIds: string[] = [];

        for (const user of staff) {
            includedStaffIds.push(String(user._id));

            // Check if salary already generated
            const existing = await SalaryRepository.findOne({
                schoolId,
                staffId: user._id,
                month,
                year
            });

            if (existing) {
                const {
                    basicSalary,
                    allowances,
                    deductions,
                    totalSalary,
                    netSalary,
                } = await this.buildMonthlySalaryComponents(
                    schoolId,
                    user._id.toString(),
                    month,
                    year
                );

                existing.basicSalary = basicSalary;
                existing.allowances = allowances;
                existing.deductions = deductions;
                existing.totalSalary = totalSalary;
                existing.netSalary = netSalary;
                await existing.save();
                updatedCount++;
                continue;
            }

            const {
                basicSalary,
                allowances,
                deductions,
                totalSalary,
                netSalary,
            } = await this.buildMonthlySalaryComponents(
                schoolId,
                user._id.toString(),
                month,
                year
            );

            await SalaryRepository.create({
                schoolId: new Types.ObjectId(schoolId) as any,
                staffId: user._id,
                month,
                year,
                basicSalary,
                allowances,
                deductions,
                totalSalary,
                netSalary,
                paidAmount: 0,
                status: SalaryStatus.PENDING
            } as any);
            createdCount++;
        }

        return { created: createdCount, updated: updatedCount, skipped: skippedCount, includedStaffIds };
    }

    /**
     * Process Salary Payment
     */
    async processPayment(
        schoolId: string,
        salaryId: string,
        paymentData: {
            amount: number;
            mode: PaymentMode;
            transactionId?: string;
            remarks?: string;
        }
    ): Promise<ISalaryRecord> {
        const salaryRecord = await SalaryRepository.findById(salaryId);

        if (!salaryRecord) throw new ErrorResponse('Salary record not found', 404);
        if (salaryRecord.schoolId.toString() !== schoolId) {
            throw new ErrorResponse('Unauthorized access', 403);
        }

        if (salaryRecord.status === SalaryStatus.PAID) {
            throw new ErrorResponse('Salary already fully paid', 400);
        }

        // Add the new payment amount to the accumulated paidAmount
        salaryRecord.paidAmount = (salaryRecord.paidAmount || 0) + paymentData.amount;

        // Determine new status
        if (salaryRecord.paidAmount >= salaryRecord.netSalary) {
            salaryRecord.status = SalaryStatus.PAID;
            // Cap it at netSalary to prevent overpayment logic complexity unless required
            salaryRecord.paidAmount = salaryRecord.netSalary;
        } else {
            salaryRecord.status = SalaryStatus.PARTIAL;
        }

        const paymentDate = new Date();
        salaryRecord.paymentDate = paymentDate;
        salaryRecord.paymentMode = paymentData.mode;

        // Push to history
        if (!salaryRecord.paymentHistory) {
            salaryRecord.paymentHistory = [];
        }

        salaryRecord.paymentHistory.push({
            amount: paymentData.amount,
            paymentMode: paymentData.mode,
            paymentDate,
            transactionId: paymentData.transactionId,
            remarks: paymentData.remarks,
        });

        salaryRecord.markModified('paymentHistory');

        // Append transaction ID and remarks if provided.
        // We might just overwrite for MVP since array history isn't requested in schema.
        if (paymentData.transactionId) {
            salaryRecord.transactionId = paymentData.transactionId;
        }
        if (paymentData.remarks) {
            salaryRecord.remarks = paymentData.remarks;
        }

        await salaryRecord.save();

        // Notify the staff member
        await UserNotification.create({
            userId: salaryRecord.staffId,
            schoolId: salaryRecord.schoolId,
            title: 'Salary Payment Processed',
            message: `An amount of ₹${paymentData.amount.toLocaleString('en-IN')} has been credited via ${paymentData.mode} on ${paymentDate.toLocaleDateString('en-IN')} (Ref: ${paymentData.transactionId || 'N/A'})`,
            type: 'salary',
            metadata: {
                salaryId: salaryRecord._id,
                amount: paymentData.amount,
                mode: paymentData.mode,
                transactionId: paymentData.transactionId,
            }
        });

        return salaryRecord;
    }

    /**
     * Get Salary Slip
     */
    async getSalarySlip(schoolId: string, salaryId: string): Promise<ISalaryRecord> {
        const record = await SalaryRepository.findOne({ _id: salaryId, schoolId });
        if (!record) throw new ErrorResponse('Salary record not found', 404);
        return record;
    }

    /**
     * Get Staff Salary for a specific month
     */
    async getSalaryByStaffAndMonth(
        schoolId: string,
        staffId: string,
        monthYear: string // e.g., "April-2024"
    ): Promise<ISalaryRecord | null> {
        const [month, yearStr] = monthYear.split('-');
        const year = parseInt(yearStr, 10);

        if (isNaN(year) || !month) {
            // Log or handle error
            return null;
        }

        return await SalaryRepository.findOne({
            schoolId,
            staffId,
            month,
            year
        });
    }

    /**
     * List salary payments (history) for a staff member, optionally filtered by year
     */
    async listSalaryPayments(
        schoolId: string,
        staffId: string,
        options?: { year?: number }
    ): Promise<ISalaryRecord[]> {
        const filter: any = { schoolId, staffId };
        if (options?.year != null) filter.year = options.year;
        return await SalaryRepository.find(filter, { sort: { year: -1, month: -1 } });
    }

    /**
     * Get Salary History for a specific staff member (alias for listSalaryPayments)
     */
    async getStaffSalaryHistory(schoolId: string, staffId: string): Promise<ISalaryRecord[]> {
        return await this.listSalaryPayments(schoolId, staffId);
    }

    /**
     * Helper to generate or refresh a single staff/month salary from structure + other payments.
     */
    async createOrUpdateMonthlyPaymentFromStructure(
        schoolId: string,
        staffId: string,
        month: string,
        year: number
    ): Promise<ISalaryRecord> {
        const [existingRecord, components] = await Promise.all([
            SalaryRepository.findOne({ schoolId, staffId, month, year }),
            this.buildMonthlySalaryComponents(schoolId, staffId, month, year),
        ]);
        const { basicSalary, allowances, deductions, totalSalary, netSalary } = components;

        if (!existingRecord) {
            return await SalaryRepository.create({
                schoolId: new Types.ObjectId(schoolId) as any,
                staffId: new Types.ObjectId(staffId) as any,
                month,
                year,
                basicSalary,
                allowances,
                deductions,
                totalSalary,
                netSalary,
                paidAmount: 0,
                status: SalaryStatus.PENDING
            } as any);
        }

        existingRecord.basicSalary = basicSalary;
        existingRecord.allowances = allowances;
        existingRecord.deductions = deductions;
        existingRecord.totalSalary = totalSalary;
        existingRecord.netSalary = netSalary;

        await existingRecord.save();
        return existingRecord;
    }

    /**
     * List other payments (bonuses/adjustments) for a staff member
     */
    async listOtherPayments(schoolId: string, staffId: string): Promise<IOtherPayment[]> {
        return await OtherPaymentRepository.listByStaff(schoolId, staffId);
    }

    /**
     * Create a one-time other payment (bonus or adjustment) for a staff member
     */
    async createOtherPayment(
        schoolId: string,
        staffId: string,
        payload: {
            title: string;
            amount: number;
            type: 'bonus' | 'adjustment';
            date: Date;
            notes?: string;
            isSettled?: boolean;
        }
    ): Promise<IOtherPayment> {
        const record = await OtherPaymentRepository.create({
            schoolId: new Types.ObjectId(schoolId) as any,
            staffId: new Types.ObjectId(staffId) as any,
            title: payload.title,
            amount: payload.amount,
            type: payload.type,
            date: payload.date,
            notes: payload.notes,
            isSettled: payload.isSettled ?? true,
        } as any);

        // Notify staff for direct bonus/deduction transactions.
        const amountText = payload.amount.toLocaleString('en-IN');
        const isBonus = payload.type === 'bonus';
        await UserNotification.create({
            userId: new Types.ObjectId(staffId),
            schoolId: new Types.ObjectId(schoolId),
            title: isBonus ? 'Bonus Credited' : 'Salary Adjustment Applied',
            message: isBonus
                ? `₹${amountText} has been credited as "${payload.title}".`
                : `₹${amountText} has been adjusted as "${payload.title}".`,
            type: 'salary',
            metadata: {
                category: 'other_payment',
                otherPaymentId: record._id,
                amount: payload.amount,
                paymentType: payload.type,
                title: payload.title,
                isSettled: payload.isSettled ?? true,
                date: payload.date,
            },
        });

        return record;
    }

    /**
     * Update Salary Structure (Add Allowances/Deductions/Base Salary)
     */
    async updateSalaryStructure(
        schoolId: string,
        salaryId: string,
        updates: {
            basicSalary?: number;
            allowances?: { title: string; amount: number }[];
            deductions?: { title: string; amount: number }[];
        }
    ): Promise<ISalaryRecord> {
        const record = await SalaryRepository.findById(salaryId);
        if (!record) throw new ErrorResponse('Salary record not found', 404);
        if (record.schoolId.toString() !== schoolId) throw new ErrorResponse('Unauthorized', 403);

        if (record.status === SalaryStatus.PAID) throw new ErrorResponse('Cannot modify paid salary', 400);

        if (updates.basicSalary !== undefined) record.basicSalary = updates.basicSalary;
        if (updates.allowances) record.allowances = updates.allowances;
        if (updates.deductions) record.deductions = updates.deductions;

        // Recalculate Logic
        const allowanceTotal = record.allowances.reduce((acc, curr) => acc + curr.amount, 0);
        const deductionTotal = record.deductions.reduce((acc, curr) => acc + curr.amount, 0);

        record.totalSalary = record.basicSalary + allowanceTotal;
        record.netSalary = record.totalSalary - deductionTotal;

        await record.save();
        return record;
    }
}

export default new SalaryService();
