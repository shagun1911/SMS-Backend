import { IStudent, StudentStatus } from '../types';
import Student from '../models/student.model';
import { BaseRepository } from './base.repository';

class StudentRepository extends BaseRepository<IStudent> {
    constructor() {
        super(Student);
    }

    async findByAdmissionNumber(schoolId: string, admissionNumber: string): Promise<IStudent | null> {
        return await this.model.findOne({ schoolId, admissionNumber }).lean().exec() as IStudent | null;
    }

    async findActiveStudents(schoolId: string): Promise<IStudent[]> {
        return await this.find({ schoolId, status: StudentStatus.ACTIVE });
    }

    async countByAdmissionPrefix(schoolId: string, prefix: string): Promise<number> {
        // Counts students whose admission number starts with the prefix for specific school
        return await this.model.countDocuments({
            schoolId,
            admissionNumber: { $regex: `^${prefix}`, $options: 'i' },
        }).exec();
    }
}

export default new StudentRepository();
