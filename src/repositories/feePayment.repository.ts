import { Types } from 'mongoose';
import { IFeePayment } from '../types';
import FeePayment from '../models/feePayment.model';
import ReceiptCounter from '../models/receiptCounter.model';
import SchoolRepository from './school.repository';
import { BaseRepository } from './base.repository';

class FeePaymentRepository extends BaseRepository<IFeePayment> {
    constructor() {
        super(FeePayment);
    }

    async findByStudent(schoolId: string, studentId: string): Promise<IFeePayment[]> {
        return await this.model
            .find({ schoolId, studentId })
            .sort({ paymentDate: -1, createdAt: -1 })
            .exec();
    }

    async findByReceiptNumber(schoolId: string, receiptNumber: string): Promise<IFeePayment | null> {
        return await this.model.findOne({ schoolId, receiptNumber }).exec();
    }

    async findPaymentsBySchool(schoolId: string, limit = 200): Promise<IFeePayment[]> {
        return await this.model
            .find({ schoolId: new Types.ObjectId(schoolId) })
            .populate('studentId', 'firstName lastName admissionNumber class section')
            .sort({ paymentDate: -1 })
            .limit(limit)
            .exec();
    }

    async findPaymentsByMonth(schoolId: string, year: number, month: number): Promise<IFeePayment[]> {
        const start = new Date(year, month - 1, 1, 0, 0, 0);
        const end = new Date(year, month, 0, 23, 59, 59);
        return await this.model
            .find({
                schoolId: new Types.ObjectId(schoolId),
                paymentDate: { $gte: start, $lte: end },
            })
            .populate('studentId', 'firstName lastName admissionNumber class section')
            .sort({ paymentDate: -1 })
            .exec();
    }

    async sumPaymentsUpToMonth(schoolId: string, year: number, month: number): Promise<number> {
        const start = new Date(year, 0, 1, 0, 0, 0);
        const end = new Date(year, month, 0, 23, 59, 59);
        const docs = await this.model
            .find({
                schoolId: new Types.ObjectId(schoolId),
                paymentDate: { $gte: start, $lte: end },
            })
            .select('amountPaid')
            .lean();
        return docs.reduce((sum: number, p: any) => sum + (p.amountPaid || 0), 0);
    }

    /**
     * Globally unique receipt id: `{SCHOOL_CODE}-{YEAR}-{SEQUENCE}` (sequence per school per calendar year).
     * Allocated atomically via ReceiptCounter to avoid duplicates under concurrency.
     */
    async getNextReceiptNumber(schoolId: string, yearPrefix: string): Promise<string> {
        const school = await SchoolRepository.findById(schoolId);
        if (!school?.schoolCode) {
            throw new Error('School not found or missing school code for receipt');
        }
        const year = parseInt(yearPrefix.trim(), 10);
        if (!Number.isFinite(year)) {
            throw new Error(`Invalid receipt year: ${yearPrefix}`);
        }
        const code = school.schoolCode.trim().toUpperCase();
        const counter = await ReceiptCounter.findOneAndUpdate(
            { schoolId: new Types.ObjectId(schoolId), year },
            { $inc: { seq: 1 } },
            { upsert: true, new: true }
        ).exec();
        if (!counter) {
            throw new Error('Failed to allocate receipt sequence');
        }
        return `${code}-${year}-${String(counter.seq).padStart(6, '0')}`;
    }
}

export default new FeePaymentRepository();
