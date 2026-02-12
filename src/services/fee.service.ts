import { IFeeStructure, IStudentFee, FeeStatus, PaymentMode } from '../types';
import FeeStructureRepository from '../repositories/feeStructure.repository';
import StudentFeeRepository from '../repositories/studentFee.repository';
import StudentRepository from '../repositories/student.repository';
import SessionRepository from '../repositories/session.repository';
import ErrorResponse from '../utils/errorResponse';
import { Types } from 'mongoose';
import StudentFee from '../models/studentFee.model';
import { getTenantFilter } from '../utils/tenant';

class FeeService {
    /**
     * Create or Update Fee Structure for a Class
     */
    async createFeeStructure(
        schoolId: string,
        data: Partial<IFeeStructure>
    ): Promise<IFeeStructure> {
        const session = await SessionRepository.findActive(schoolId);
        if (!session) throw new ErrorResponse('No active session found', 400);

        const existing = await FeeStructureRepository.findByClass(
            schoolId,
            session._id.toString(),
            data.class!
        );

        if (existing) {
            throw new ErrorResponse(`Fee structure already exists for Class ${data.class}`, 400);
        }

        return await FeeStructureRepository.create({
            ...data,
            schoolId: new Types.ObjectId(schoolId) as any,
            sessionId: session._id,
        });
    }

    /**
     * Generate Monthly Fees for All Students in a Class
     */
    async generateMonthlyFees(
        schoolId: string,
        className: string,
        month: string,
        dueDate: Date
    ): Promise<{ created: number; skipped: number }> {
        const session = await SessionRepository.findActive(schoolId);
        if (!session) throw new ErrorResponse('No active session found', 400);

        // 1. Get Fee Structure
        const structure = await FeeStructureRepository.findByClass(
            schoolId,
            session._id.toString(),
            className
        );
        if (!structure) throw new ErrorResponse(`Fee structure not found for Class ${className}`, 404);

        // 2. Get Students in Class
        const students = await StudentRepository.find({
            schoolId,
            class: className,
            isActive: true
        });

        let createdCount = 0;
        let skippedCount = 0;

        // 3. Create Fee Records
        for (const student of students) {
            // Check if already exists
            const existing = await StudentFeeRepository.findByStudentMonth(
                schoolId,
                student._id.toString(),
                session._id.toString(),
                month
            );

            if (existing) {
                skippedCount++;
                continue;
            }

            // Calculate Total
            const monthlyFees = structure.fees.filter(f => f.type === 'monthly');
            const monthlyTotal = monthlyFees.reduce((sum, f) => sum + f.amount, 0);

            await StudentFeeRepository.create({
                schoolId: new Types.ObjectId(schoolId) as any,
                studentId: student._id,
                sessionId: session._id,
                month,
                feeBreakdown: monthlyFees.map(f => ({
                    title: f.title,
                    amount: f.amount,
                    type: f.type
                })),
                totalAmount: monthlyTotal,
                paidAmount: 0,
                remainingAmount: monthlyTotal,
                status: FeeStatus.PENDING,
                dueDate,
                payments: [],
                discount: 0,
                lateFee: 0
            });
            createdCount++;
        }

        return { created: createdCount, skipped: skippedCount };
    }

    /**
     * Record Fee Payment
     */
    async recordPayment(
        schoolId: string,
        feeId: string,
        paymentData: {
            amount: number;
            mode: PaymentMode;
            staffId: string;
            remarks?: string;
            transactionId?: string;
        }
    ): Promise<IStudentFee> {
        const feeRecord = await StudentFeeRepository.findById(feeId);

        if (!feeRecord) throw new ErrorResponse('Fee record not found', 404);
        if (feeRecord.schoolId.toString() !== schoolId) {
            throw new ErrorResponse('Unauthorized access to fee record', 403);
        }

        if (feeRecord.status === FeeStatus.PAID) {
            throw new ErrorResponse('Fee already fully paid', 400);
        }

        if (paymentData.amount <= 0) {
            throw new ErrorResponse('Invalid payment amount', 400);
        }

        const newPaidAmount = feeRecord.paidAmount + paymentData.amount;
        if (newPaidAmount > feeRecord.totalAmount + feeRecord.lateFee - feeRecord.discount) {
            throw new ErrorResponse('Payment exceeds remaining amount', 400);
        }

        // Add Payment
        feeRecord.payments.push({
            amount: paymentData.amount,
            paymentDate: new Date(),
            paymentMode: paymentData.mode,
            receivedBy: new Types.ObjectId(paymentData.staffId) as any,
            remarks: paymentData.remarks,
            transactionId: paymentData.transactionId,
        });

        feeRecord.paidAmount = newPaidAmount;
        feeRecord.remainingAmount = feeRecord.totalAmount + (feeRecord.lateFee || 0) - (feeRecord.discount || 0) - newPaidAmount;
        if (feeRecord.remainingAmount <= 0) feeRecord.status = FeeStatus.PAID;

        await feeRecord.save();
        return feeRecord;
    }

    /**
     * Get Student Ledger
     */
    async getStudentLedger(schoolId: string, studentId: string): Promise<IStudentFee[]> {
        const session = await SessionRepository.findActive(schoolId);
        if (!session) throw new ErrorResponse('No active session found', 400);

        return await StudentFeeRepository.findByStudent(schoolId, studentId, session._id.toString());
    }

    /**
     * Get Collection Report
     */
    async getCollectionReport(schoolId: string, month?: string): Promise<{ total: number }> {
        const session = await SessionRepository.findActive(schoolId);
        if (!session) throw new ErrorResponse('No active session found', 400);

        const total = await StudentFeeRepository.sumCollection(schoolId, session._id.toString(), month);
        return { total };
    }

    /**
     * List all student fees with filters
     */
    async listAllFees(schoolId: string, filters: any): Promise<IStudentFee[]> {
        const filter = getTenantFilter(schoolId, filters);
        return await StudentFee.find(filter)
            .populate('studentId', 'firstName lastName admissionNumber photo')
            .populate('sessionId', 'name')
            .sort({ createdAt: -1 });
    }

    /**
     * Quick collect fee: find or create a fee record for student+month and record payment
     */
    async collectFee(
        schoolId: string,
        payload: {
            studentId: string;
            amount: number;
            month?: string;
            feeTitle?: string;
            mode: PaymentMode;
            transactionId?: string;
            remarks?: string;
            staffId: string;
        }
    ): Promise<IStudentFee> {
        const session = await SessionRepository.findActive(schoolId);
        if (!session) throw new ErrorResponse('No active session found', 400);

        const month = payload.month || new Date().toLocaleString('default', { month: 'long' });
        let feeRecord = await StudentFeeRepository.findByStudentMonth(
            schoolId,
            payload.studentId,
            session._id.toString(),
            month
        );

        if (!feeRecord) {
            feeRecord = await StudentFeeRepository.create({
                schoolId: new Types.ObjectId(schoolId) as any,
                studentId: new Types.ObjectId(payload.studentId) as any,
                sessionId: session._id,
                month,
                feeBreakdown: [{ title: payload.feeTitle || 'Fee', amount: payload.amount, type: 'monthly' }],
                totalAmount: payload.amount,
                paidAmount: 0,
                remainingAmount: payload.amount,
                status: FeeStatus.PENDING,
                dueDate: new Date(),
                payments: [],
                discount: 0,
                lateFee: 0,
            } as any);
        }

        return await this.recordPayment(schoolId, feeRecord._id.toString(), {
            amount: payload.amount,
            mode: payload.mode,
            staffId: payload.staffId,
            transactionId: payload.transactionId,
            remarks: payload.remarks,
        });
    }

    /**
     * Get fee summary stats for dashboard
     */
    async getFeeStats(schoolId: string): Promise<{
        totalCollected: number;
        outstanding: number;
        collectionRate: number;
        transactionCount: number;
    }> {
        const schoolObjId = new Types.ObjectId(schoolId);
        const [collected, pending, transactionCount] = await Promise.all([
            StudentFee.aggregate([
                { $match: { schoolId: schoolObjId, status: 'paid' } },
                { $group: { _id: null, total: { $sum: '$paidAmount' } } }
            ]),
            StudentFee.aggregate([
                { $match: { schoolId: schoolObjId, status: { $in: ['pending', 'partial'] } } },
                { $group: { _id: null, total: { $sum: '$remainingAmount' } } }
            ]),
            StudentFee.countDocuments({ schoolId: schoolObjId })
        ]);
        const totalCollected = collected[0]?.total ?? 0;
        const outstanding = pending[0]?.total ?? 0;
        const totalExpected = totalCollected + outstanding;
        const collectionRate = totalExpected > 0 ? Math.round((totalCollected / totalExpected) * 100) : 0;
        return { totalCollected, outstanding, collectionRate, transactionCount };
    }
}

export default new FeeService();
