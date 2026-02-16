import { Types } from 'mongoose';
import { IFeePayment } from '../types';
import FeePayment from '../models/feePayment.model';
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

    async getNextReceiptNumber(schoolId: string, yearPrefix: string): Promise<string> {
        const pattern = new RegExp(`^SSMS-${yearPrefix}-(\\d+)$`);
        const last = await this.model
            .findOne({ schoolId: new Types.ObjectId(schoolId), receiptNumber: pattern })
            .sort({ receiptNumber: -1 })
            .exec();
        const nextNum = last ? parseInt((last.receiptNumber as string).match(/\d+$/)?.[0] || '0', 10) + 1 : 1;
        return `SSMS-${yearPrefix}-${String(nextNum).padStart(5, '0')}`;
    }
}

export default new FeePaymentRepository();
