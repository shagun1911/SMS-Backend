import { ISalaryRecord, SalaryStatus, UserRole, PaymentMode } from '../types';
import SalaryRepository from '../repositories/salary.repository';
import UserRepository from '../repositories/user.repository';
import ErrorResponse from '../utils/errorResponse';
import { Types } from 'mongoose';

class SalaryService {
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

            const basicSalary = user.baseSalary || 0;

            await SalaryRepository.create({
                schoolId: new Types.ObjectId(schoolId) as any,
                staffId: user._id,
                month,
                year,
                basicSalary,
                allowances: [],
                deductions: [],
                totalSalary: basicSalary,
                netSalary: basicSalary,
                status: SalaryStatus.PENDING
            });
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
     * Get Salary History for a specific staff member
     */
    async getStaffSalaryHistory(schoolId: string, staffId: string): Promise<ISalaryRecord[]> {
        return await SalaryRepository.find({
            schoolId,
            staffId
        }, { sort: { year: -1, month: -1 } });
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
