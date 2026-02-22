import { ISalaryRecord, SalaryStatus, UserRole, PaymentMode, ISalaryStructure, IOtherPayment } from '../types';
import SalaryRepository from '../repositories/salary.repository';
import UserRepository from '../repositories/user.repository';
import SalaryStructureRepository from '../repositories/salaryStructure.repository';
import OtherPaymentRepository from '../repositories/otherPayment.repository';
import ErrorResponse from '../utils/errorResponse';
import { Types } from 'mongoose';

class SalaryService {
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
        return Salary.find(filter)
            .populate('staffId', 'name email role')
            .sort({ createdAt: -1 })
            .lean();
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
        totalNetAmount: number;
        totalPendingAmount: number;
        totalPaidAmount: number;
    }> {
        const filter: any = { schoolId };
        if (opts.month) filter.month = opts.month;
        if (opts.year) filter.year = opts.year;

        const Salary = (await import('../models/salary.model')).default;
        const records = await Salary.find(filter).lean();
        let pendingCount = 0, paidCount = 0, holdCount = 0;
        let totalNetAmount = 0, totalPendingAmount = 0, totalPaidAmount = 0;
        for (const r of records as any[]) {
            totalNetAmount += r.netSalary || 0;
            if (r.status === 'paid') { paidCount++; totalPaidAmount += r.netSalary || 0; }
            else if (r.status === 'hold') { holdCount++; totalPendingAmount += r.netSalary || 0; }
            else { pendingCount++; totalPendingAmount += r.netSalary || 0; }
        }
        return { totalRecords: records.length, pendingCount, paidCount, holdCount, totalNetAmount, totalPendingAmount, totalPaidAmount };
    }

    /**
     * Get active salary structure for a staff member
     */
    async getSalaryStructure(
        schoolId: string,
        staffId: string
    ): Promise<ISalaryStructure | null> {
        return await SalaryStructureRepository.findActiveByStaff(schoolId, staffId);
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
    ): Promise<{ created: number; skipped: number }> {
        // 1. Get Active Staff (Teachers, Accountants, etc.)
        const staff = await UserRepository.find({
            schoolId,
            isActive: true,
            role: { $in: [UserRole.TEACHER, UserRole.ACCOUNTANT, UserRole.TRANSPORT_MANAGER, UserRole.SCHOOL_ADMIN] },
            ...(specificStaffId && { _id: specificStaffId })
        });

        let createdCount = 0;
        let skippedCount = 0;

        for (const user of staff) {
            // Check if salary already generated
            const existing = await SalaryRepository.findOne({
                schoolId,
                staffId: user._id,
                month,
                year
            });

            if (existing) {
                skippedCount++;
                continue;
            }

            // Prefer explicit salary structure; fall back to user's baseSalary
            const structure = await SalaryStructureRepository.findActiveByStaff(
                schoolId,
                user._id.toString()
            );

            const basicSalary = structure?.baseSalary ?? user.baseSalary ?? 0;
            const allowances = structure?.allowances || [];
            const deductions = structure?.deductions || [];

            // Include other payments for this month (bonuses/adjustments)
            const monthStart = new Date(year, new Date(`${month} 1, ${year}`).getMonth(), 1);
            const monthEnd = new Date(monthStart);
            monthEnd.setMonth(monthEnd.getMonth() + 1);
            monthEnd.setDate(monthEnd.getDate() - 1);

            const otherPayments = await OtherPaymentRepository.findByStaffAndDateRange(
                schoolId,
                user._id.toString(),
                monthStart,
                monthEnd
            );

            const bonusTotal = otherPayments
                .filter((p) => p.type === 'bonus')
                .reduce((sum, p) => sum + p.amount, 0);
            const adjustmentTotal = otherPayments
                .filter((p) => p.type === 'adjustment')
                .reduce((sum, p) => sum + p.amount, 0);

            const allowanceTotal = allowances.reduce((acc, curr) => acc + curr.amount, 0) + bonusTotal;
            const deductionTotal = deductions.reduce((acc, curr) => acc + curr.amount, 0) + adjustmentTotal;

            const totalSalary = basicSalary + allowanceTotal;
            const netSalary = totalSalary - deductionTotal;

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
                status: SalaryStatus.PENDING
            } as any);
            createdCount++;
        }

        return { created: createdCount, skipped: skippedCount };
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
            throw new ErrorResponse('Salary already paid', 400);
        }

        // Update status
        salaryRecord.status = SalaryStatus.PAID;
        salaryRecord.paymentDate = new Date();
        salaryRecord.paymentMode = paymentData.mode;
        salaryRecord.transactionId = paymentData.transactionId;
        salaryRecord.remarks = paymentData.remarks;

        await salaryRecord.save(); // BaseRepository update method re-fetches, so save is better here for object mutation
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
        const [existingRecord, structure] = await Promise.all([
            SalaryRepository.findOne({ schoolId, staffId, month, year }),
            SalaryStructureRepository.findActiveByStaff(schoolId, staffId),
        ]);

        const staff = await UserRepository.findById(staffId);
        if (!staff || staff.schoolId?.toString() !== schoolId) {
            throw new ErrorResponse('Staff member not found', 404);
        }

        const basicSalary = structure?.baseSalary ?? staff.baseSalary ?? 0;
        const baseAllowances = structure?.allowances || [];
        const baseDeductions = structure?.deductions || [];

        const monthStart = new Date(year, new Date(`${month} 1, ${year}`).getMonth(), 1);
        const monthEnd = new Date(monthStart);
        monthEnd.setMonth(monthEnd.getMonth() + 1);
        monthEnd.setDate(monthEnd.getDate() - 1);

        const otherPayments = await OtherPaymentRepository.findByStaffAndDateRange(
            schoolId,
            staffId,
            monthStart,
            monthEnd
        );

        const bonusTotal = otherPayments
            .filter((p) => p.type === 'bonus')
            .reduce((sum, p) => sum + p.amount, 0);
        const adjustmentTotal = otherPayments
            .filter((p) => p.type === 'adjustment')
            .reduce((sum, p) => sum + p.amount, 0);

        const allowances = [...baseAllowances];
        if (bonusTotal > 0) {
            allowances.push({ title: 'Bonuses & incentives', amount: bonusTotal });
        }

        const deductions = [...baseDeductions];
        if (adjustmentTotal > 0) {
            deductions.push({ title: 'Adjustments', amount: adjustmentTotal });
        }

        const allowanceTotal = allowances.reduce((acc, curr) => acc + curr.amount, 0);
        const deductionTotal = deductions.reduce((acc, curr) => acc + curr.amount, 0);

        const totalSalary = basicSalary + allowanceTotal;
        const netSalary = totalSalary - deductionTotal;

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
        }
    ): Promise<IOtherPayment> {
        return await OtherPaymentRepository.create({
            schoolId: new Types.ObjectId(schoolId) as any,
            staffId: new Types.ObjectId(staffId) as any,
            title: payload.title,
            amount: payload.amount,
            type: payload.type,
            date: payload.date,
            notes: payload.notes,
        } as any);
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
