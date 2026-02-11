import { IStudentFee, FeeStatus } from '../types';
import StudentFee from '../models/studentFee.model';
import { BaseRepository } from './base.repository';

class StudentFeeRepository extends BaseRepository<IStudentFee> {
    constructor() {
        super(StudentFee);
    }

    async findByStudent(
        schoolId: string,
        studentId: string,
        sessionId: string
    ): Promise<IStudentFee[]> {
        return await this.model.find({
            schoolId,
            studentId,
            sessionId
        }).sort({ month: 1 });
    }

    async findPending(
        schoolId: string,
        sessionId: string
    ): Promise<IStudentFee[]> {
        return await this.model.find({
            schoolId,
            sessionId,
            status: { $in: [FeeStatus.PENDING, FeeStatus.PARTIAL, FeeStatus.OVERDUE] }
        });
    }

    async findByMonth(
        schoolId: string,
        sessionId: string,
        month: string
    ): Promise<IStudentFee[]> {
        return await this.model.find({ schoolId, sessionId, month });
    }

    async findByStudentMonth(
        schoolId: string,
        studentId: string,
        sessionId: string,
        month: string
    ): Promise<IStudentFee | null> {
        return await this.model.findOne({ schoolId, studentId, sessionId, month });
    }

    async sumCollection(
        schoolId: string,
        sessionId: string,
        month?: string
    ): Promise<number> {
        const query: any = { schoolId, sessionId };
        if (month) query.month = month;

        const result = await this.model.aggregate([
            { $match: query },
            { $group: { _id: null, total: { $sum: "$paidAmount" } } }
        ]);

        return result[0]?.total || 0;
    }
}

export default new StudentFeeRepository();
