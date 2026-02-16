import { IFeeStructure, IStudentFee, IFeePayment, FeeStatus, PaymentMode } from '../types';
import FeeStructureRepository from '../repositories/feeStructure.repository';
import FeePaymentRepository from '../repositories/feePayment.repository';
import StudentFeeRepository from '../repositories/studentFee.repository';
import StudentRepository from '../repositories/student.repository';
import SessionRepository from '../repositories/session.repository';
import SchoolRepository from '../repositories/school.repository';
import ErrorResponse from '../utils/errorResponse';
import { Types } from 'mongoose';
import StudentFee from '../models/studentFee.model';
import Student from '../models/student.model';
import { getTenantFilter } from '../utils/tenant';
import { generateFeeStructurePDF } from './pdfFeeStructure.service';
import { generateReceiptPDF } from './pdfReceipt.service';
import path from 'path';
import fs from 'fs';

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

        const payload: any = {
            ...data,
            schoolId: new Types.ObjectId(schoolId),
            sessionId: session._id,
        };
        if (data.classId) payload.classId = new Types.ObjectId(String(data.classId));
        if (data.components && data.components.length > 0) {
            payload.components = data.components;
            // totalAmount/totalAnnualFee computed by model pre-save (monthly×12 + one-time)
        }
        return await FeeStructureRepository.create(payload);
    }

    async getStructureByClass(schoolId: string, classIdOrName: string): Promise<IFeeStructure | null> {
        const session = await SessionRepository.findActive(schoolId);
        if (!session) return null;
        return await FeeStructureRepository.findByClass(schoolId, session._id.toString(), classIdOrName);
    }

    async getStructuresBySession(schoolId: string): Promise<IFeeStructure[]> {
        const session = await SessionRepository.findActive(schoolId);
        if (!session) return [];
        return await FeeStructureRepository.findBySession(schoolId, session._id.toString());
    }

    async updateFeeStructure(schoolId: string, structureId: string, data: Partial<IFeeStructure>): Promise<IFeeStructure | null> {
        const existing = await FeeStructureRepository.findById(structureId);
        if (!existing || existing.schoolId.toString() !== schoolId) return null;
        if (data.components && data.components.length > 0) {
            // totalAmount/totalAnnualFee will be recomputed by model pre-save on next save
            // update() may not run pre-save; fetch, set components, save to trigger hook
            const existing = await FeeStructureRepository.findById(structureId);
            if (existing) {
                (existing as any).components = data.components;
                await (existing as any).save();
                return existing;
            }
        }
        return await FeeStructureRepository.update(structureId, data);
    }

    async deleteFeeStructure(schoolId: string, structureId: string): Promise<boolean> {
        const existing = await FeeStructureRepository.findById(structureId);
        if (!existing || existing.schoolId.toString() !== schoolId) return false;
        await FeeStructureRepository.delete(structureId);
        return true;
    }

    async getStructurePrintPdf(schoolId: string, structureId: string): Promise<Buffer> {
        const structure = await FeeStructureRepository.findById(structureId);
        if (!structure || structure.schoolId.toString() !== schoolId) {
            throw new ErrorResponse('Fee structure not found', 404);
        }
        const school = await SchoolRepository.findById(schoolId);
        const session = await SessionRepository.findActive(schoolId);
        if (!school || !session) throw new ErrorResponse('School or session not found', 404);
        return await generateFeeStructurePDF({ school, session, structure });
    }

    /**
     * Yearly fee payment: create FeePayment, update student paid/due, generate receipt PDF
     */
    async payFee(
        schoolId: string,
        payload: { studentId: string; amountPaid: number; paymentMode: string; paymentDate?: string }
    ): Promise<{ payment: IFeePayment; pdfBuffer: Buffer }> {
        const student = await StudentRepository.findById(payload.studentId);
        if (!student || student.schoolId.toString() !== schoolId) {
            throw new ErrorResponse('Student not found', 404);
        }
        let totalYearly = student.totalYearlyFee ?? 0;
        if (totalYearly === 0 && student.class) {
            const structure = await FeeStructureRepository.findByClass(
                schoolId,
                (await SessionRepository.findActive(schoolId))?._id?.toString() || '',
                student.class
            );
            if (structure) {
                totalYearly = structure.totalAmount ?? structure.totalAnnualFee ?? 0;
                await StudentRepository.update(payload.studentId, {
                    totalYearlyFee: totalYearly,
                    dueAmount: totalYearly - (student.paidAmount ?? 0),
                } as any);
            }
        }
        const previousPaid = student.paidAmount ?? 0;
        const dueBefore = (student as any).dueAmount ?? totalYearly - previousPaid;
        if (payload.amountPaid <= 0) throw new ErrorResponse('Invalid payment amount', 400);
        if (payload.amountPaid > dueBefore) throw new ErrorResponse('Payment exceeds remaining due', 400);

        const session = await SessionRepository.findActive(schoolId);
        if (!session) throw new ErrorResponse('No active session', 400);
        const yearPrefix = session.sessionYear ? session.sessionYear.split('-')[0] : String(new Date().getFullYear());
        const receiptNumber = await FeePaymentRepository.getNextReceiptNumber(schoolId, yearPrefix);

        const paymentDate = payload.paymentDate ? new Date(payload.paymentDate) : new Date();
        const remainingDue = dueBefore - payload.amountPaid;
        const newPaidAmount = previousPaid + payload.amountPaid;

        const payment = await FeePaymentRepository.create({
            schoolId: new Types.ObjectId(schoolId) as any,
            studentId: new Types.ObjectId(payload.studentId) as any,
            receiptNumber,
            amountPaid: payload.amountPaid,
            paymentMode: payload.paymentMode,
            paymentDate,
            previousDue: dueBefore,
            remainingDue,
        } as any);

        await StudentRepository.update(payload.studentId, {
            paidAmount: newPaidAmount,
            dueAmount: remainingDue,
        } as any);

        const school = await SchoolRepository.findById(schoolId);
        if (!school) throw new ErrorResponse('School not found', 404);
        const pdfBuffer = await generateReceiptPDF({
            school,
            payment,
            student,
            totalAnnualFee: totalYearly,
            previousPaid,
            thisPayment: payload.amountPaid,
            remainingDue,
        });

        const receiptsDir = path.join(process.cwd(), 'receipts');
        if (!fs.existsSync(receiptsDir)) fs.mkdirSync(receiptsDir, { recursive: true });
        const pdfPath = path.join(receiptsDir, `${payment.receiptNumber.replace(/\//g, '-')}.pdf`);
        fs.writeFileSync(pdfPath, pdfBuffer);
        await FeePaymentRepository.update(payment._id.toString(), { pdfPath } as any);

        return { payment, pdfBuffer };
    }

    async getStudentFeePayments(schoolId: string, studentId: string): Promise<IFeePayment[]> {
        return await FeePaymentRepository.findByStudent(schoolId, studentId);
    }

    async getStudentFeeSummary(schoolId: string, studentId: string): Promise<{ student: any; payments: IFeePayment[] } | null> {
        const student = await StudentRepository.findById(studentId);
        if (!student || student.schoolId.toString() !== schoolId) return null;
        const totalFromStudent = (student as any).totalYearlyFee ?? 0;
        const studentClass = (student as any).class;
        if (totalFromStudent === 0 && studentClass) {
            const session = await SessionRepository.findActive(schoolId);
            if (session) {
                let structure = await FeeStructureRepository.findByClass(
                    schoolId,
                    session._id.toString(),
                    studentClass
                );
                if (!structure && typeof studentClass === 'string' && studentClass.includes(' ')) {
                    structure = await FeeStructureRepository.findByClass(
                        schoolId,
                        session._id.toString(),
                        studentClass.split(' ')[0]
                    );
                }
                if (structure) {
                    const annualTotal = structure.totalAmount ?? structure.totalAnnualFee ?? 0;
                    await StudentRepository.update(studentId, {
                        totalYearlyFee: annualTotal,
                        dueAmount: annualTotal - ((student as any).paidAmount ?? 0),
                    } as any);
                    const updated = await StudentRepository.findById(studentId);
                    if (updated) {
                        const payments = await FeePaymentRepository.findByStudent(schoolId, studentId);
                        return { student: updated, payments };
                    }
                }
            }
        }
        const payments = await FeePaymentRepository.findByStudent(schoolId, studentId);
        return { student, payments };
    }

    async getReceiptPdf(schoolId: string, receiptId: string): Promise<Buffer> {
        const payment = await FeePaymentRepository.findById(receiptId);
        if (!payment || payment.schoolId.toString() !== schoolId) {
            throw new ErrorResponse('Receipt not found', 404);
        }
        const student = await StudentRepository.findById(payment.studentId.toString());
        const school = await SchoolRepository.findById(schoolId);
        if (!student || !school) throw new ErrorResponse('Student or school not found', 404);
        const totalYearly = student.totalYearlyFee ?? 0;
        const previousPaid = (student.paidAmount ?? 0) - payment.amountPaid;
        return await generateReceiptPDF({
            school,
            payment,
            student,
            totalAnnualFee: totalYearly,
            previousPaid,
            thisPayment: payment.amountPaid,
            remainingDue: payment.remainingDue,
        });
    }

    async listFeePayments(schoolId: string, limit = 200): Promise<IFeePayment[]> {
        return await FeePaymentRepository.findPaymentsBySchool(schoolId, limit);
    }

    async getDefaulters(schoolId: string): Promise<any[]> {
        return await Student.find({
            schoolId: new Types.ObjectId(schoolId),
            isActive: true,
            dueAmount: { $gt: 0 },
        })
            .sort({ class: 1, section: 1 })
            .lean();
    }

    /**
     * Process initial deposit on student registration: set totalYearlyFee, create first receipt, update student
     */
    async processInitialDeposit(
        schoolId: string,
        student: any,
        data: { initialDepositAmount: number; paymentMode?: string; depositDate?: Date }
    ): Promise<IFeePayment | null> {
        if (!data.initialDepositAmount || data.initialDepositAmount <= 0) return null;
        const session = await SessionRepository.findActive(schoolId);
        if (!session) return null;
        let totalYearly = student.totalYearlyFee ?? 0;
        if (totalYearly === 0 && student.class) {
            const structure = await FeeStructureRepository.findByClass(schoolId, session._id.toString(), student.class);
            if (structure) totalYearly = structure.totalAmount ?? structure.totalAnnualFee ?? 0;
        }
        if (totalYearly === 0) totalYearly = data.initialDepositAmount;
        const yearPrefix = session.sessionYear ? session.sessionYear.split('-')[0] : String(new Date().getFullYear());
        const receiptNumber = await FeePaymentRepository.getNextReceiptNumber(schoolId, yearPrefix);
        const paymentDate = data.depositDate ? new Date(data.depositDate) : new Date();
        const remainingDue = totalYearly - data.initialDepositAmount;
        const payment = await FeePaymentRepository.create({
            schoolId: new Types.ObjectId(schoolId) as any,
            studentId: student._id,
            receiptNumber,
            amountPaid: data.initialDepositAmount,
            paymentMode: data.paymentMode || 'cash',
            paymentDate,
            previousDue: 0,
            remainingDue,
        } as any);
        await StudentRepository.update(student._id.toString(), {
            totalYearlyFee: totalYearly,
            paidAmount: data.initialDepositAmount,
            dueAmount: remainingDue,
            initialDepositAmount: data.initialDepositAmount,
            depositPaymentMode: data.paymentMode,
            depositDate: paymentDate,
        } as any);
        const school = await SchoolRepository.findById(schoolId);
        if (school) {
            const pdfBuffer = await generateReceiptPDF({
                school,
                payment,
                student: { ...student, totalYearlyFee: totalYearly, paidAmount: data.initialDepositAmount, dueAmount: remainingDue },
                totalAnnualFee: totalYearly,
                previousPaid: 0,
                thisPayment: data.initialDepositAmount,
                remainingDue,
            });
            const receiptsDir = path.join(process.cwd(), 'receipts');
            if (!fs.existsSync(receiptsDir)) fs.mkdirSync(receiptsDir, { recursive: true });
            const pdfPath = path.join(receiptsDir, `${payment.receiptNumber.replace(/\//g, '-')}.pdf`);
            fs.writeFileSync(pdfPath, pdfBuffer);
            await FeePaymentRepository.update(payment._id.toString(), { pdfPath } as any);
        }
        return payment;
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
            const monthlyFees = (structure.fees || []).filter((f: any) => f.type === 'monthly');
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
     * Get fee summary stats for dashboard (yearly + monthly fee data)
     */
    async getFeeStats(schoolId: string): Promise<{
        totalCollected: number;
        outstanding: number;
        collectionRate: number;
        transactionCount: number;
        totalExpected?: number;
        defaulterCount?: number;
        monthlyCollection?: { month: string; amount: number }[];
    }> {
        const schoolObjId = new Types.ObjectId(schoolId);
        const FeePayment = (await import('../models/feePayment.model')).default;
        const [collected, pending, monthlyCount, yearlyExpected, yearlyCollected, yearlyPending, defaulterCount, paymentCount, monthlyPayments] = await Promise.all([
            StudentFee.aggregate([
                { $match: { schoolId: schoolObjId, status: 'paid' } },
                { $group: { _id: null, total: { $sum: '$paidAmount' } } }
            ]),
            StudentFee.aggregate([
                { $match: { schoolId: schoolObjId, status: { $in: ['pending', 'partial'] } } },
                { $group: { _id: null, total: { $sum: '$remainingAmount' } } }
            ]),
            StudentFee.countDocuments({ schoolId: schoolObjId }),
            Student.aggregate([
                { $match: { schoolId: schoolObjId, isActive: true, totalYearlyFee: { $gt: 0 } } },
                { $group: { _id: null, total: { $sum: '$totalYearlyFee' } } }
            ]),
            Student.aggregate([
                { $match: { schoolId: schoolObjId, isActive: true } },
                { $group: { _id: null, total: { $sum: '$paidAmount' } } }
            ]),
            Student.aggregate([
                { $match: { schoolId: schoolObjId, isActive: true, dueAmount: { $gt: 0 } } },
                { $group: { _id: null, total: { $sum: '$dueAmount' } } }
            ]),
            Student.countDocuments({ schoolId: schoolObjId, isActive: true, dueAmount: { $gt: 0 } }),
            FeePayment.countDocuments({ schoolId: schoolObjId }),
            (async () => {
                const payments = await FeePayment.find({ schoolId: schoolObjId }).lean();
                const byMonth: Record<string, number> = {};
                payments.forEach((p: any) => {
                    const d = new Date(p.paymentDate);
                    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
                    byMonth[key] = (byMonth[key] || 0) + (p.amountPaid || 0);
                });
                return Object.entries(byMonth)
                    .sort((a, b) => a[0].localeCompare(b[0]))
                    .slice(-12)
                    .map(([month, amount]) => ({ month, amount }));
            })(),
        ]);
        const yearlyCollectedTotal = yearlyCollected[0]?.total ?? 0;
        const yearlyPendingTotal = yearlyPending[0]?.total ?? 0;
        const monthlyFeeCollected = collected[0]?.total ?? 0;
        const monthlyFeePending = pending[0]?.total ?? 0;
        const totalCollected = yearlyCollectedTotal || monthlyFeeCollected;
        const outstanding = yearlyPendingTotal || monthlyFeePending;
        const totalExpected = yearlyExpected[0]?.total ?? 0;
        const totalExpectedAll = totalExpected || totalCollected + outstanding;
        const collectionRate = totalExpectedAll > 0 ? Math.round((totalCollected / totalExpectedAll) * 100) : 0;
        return {
            totalCollected,
            outstanding,
            collectionRate,
            transactionCount: paymentCount + monthlyCount,
            totalExpected: totalExpectedAll || undefined,
            defaulterCount,
            monthlyCollection: monthlyPayments as { month: string; amount: number }[],
        };
    }
}

export default new FeeService();
