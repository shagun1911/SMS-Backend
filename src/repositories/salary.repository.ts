import { ISalaryRecord, SalaryStatus } from '../types';
import Salary from '../models/salary.model';
import { BaseRepository } from './base.repository';

class SalaryRepository extends BaseRepository<ISalaryRecord> {
    constructor() {
        super(Salary);
    }

    async findByMonth(
        schoolId: string,
        month: string,
        year: number
    ): Promise<ISalaryRecord[]> {
        return await this.model.find({
            schoolId,
            month,
            year
        });
    }

    async findByStaff(
        schoolId: string,
        staffId: string,
        year: number
    ): Promise<ISalaryRecord[]> {
        return await this.model.find({
            schoolId,
            staffId,
            year
        }).sort({ month: -1 });
    }

    async aggregateTotalExpense(
        schoolId: string,
        month: string,
        year: number
    ): Promise<number> {
        const result = await this.model.aggregate([
            { $match: { schoolId, month, year, status: SalaryStatus.PAID } },
            { $group: { _id: null, total: { $sum: "$netSalary" } } }
        ]);
        return result[0]?.total || 0;
    }
}

export default new SalaryRepository();
