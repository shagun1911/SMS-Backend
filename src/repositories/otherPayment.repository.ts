import { IOtherPayment } from '../types';
import OtherPayment from '../models/otherPayment.model';
import { BaseRepository } from './base.repository';

class OtherPaymentRepository extends BaseRepository<IOtherPayment> {
    constructor() {
        super(OtherPayment);
    }

    async listByStaff(schoolId: string, staffId: string): Promise<IOtherPayment[]> {
        return await this.model.find({
            schoolId,
            staffId,
        }).sort({ date: -1 }).exec();
    }

    async findByStaffAndDateRange(
        schoolId: string,
        staffId: string,
        from: Date,
        to: Date
    ): Promise<IOtherPayment[]> {
        return await this.model.find({
            schoolId,
            staffId,
            date: { $gte: from, $lte: to },
            isSettled: false,
        }).sort({ date: 1 }).exec();
    }

    async findSettledByStaffAndDateRange(
        schoolId: string,
        staffId: string,
        from: Date,
        to: Date
    ): Promise<IOtherPayment[]> {
        return await this.model.find({
            schoolId,
            staffId,
            date: { $gte: from, $lte: to },
            isSettled: true,
        }).sort({ date: 1 }).exec();
    }
}

export default new OtherPaymentRepository();

