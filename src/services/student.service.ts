import { IStudent, StudentStatus } from '../types';
import StudentRepository from '../repositories/student.repository';
import SchoolRepository from '../repositories/school.repository';
import SessionRepository from '../repositories/session.repository';
import ErrorResponse from '../utils/errorResponse';
import Student from '../models/student.model';
import { getTenantFilter } from '../utils/tenant';
import { updateUsageForSchool } from './usage.service';

class StudentService {
    /**
     * Create a new student with auto-generated admission number
     */
    async createStudent(schoolId: string, studentData: Partial<IStudent>): Promise<IStudent> {
        const activeSession = await SessionRepository.findActive(schoolId);
        if (!activeSession) {
            throw new ErrorResponse('No active session found. Please create a session first.', 400);
        }

        const school = await SchoolRepository.findById(schoolId);
        if (!school) {
            throw new ErrorResponse('School not found', 404);
        }

        const admissionNumber = await this.generateAdmissionNumber(schoolId, school.schoolCode);

        // Default password = DOB as DDMMYYYY (e.g. 15082010)
        let defaultPassword = admissionNumber; // fallback
        if (studentData.dateOfBirth) {
            const dob = new Date(studentData.dateOfBirth);
            const dd = String(dob.getDate()).padStart(2, '0');
            const mm = String(dob.getMonth() + 1).padStart(2, '0');
            const yyyy = dob.getFullYear();
            defaultPassword = `${dd}${mm}${yyyy}`;
        }

        // admissionNumber is already generated at line 25

        let username = studentData.firstName?.trim().toLowerCase() || '';

        // Check for siblings (same name and DOB) in the same school
        if (studentData.firstName && studentData.dateOfBirth) {
            const hasSibling = await Student.findOne({
                schoolId: school._id,
                firstName: { $regex: new RegExp(`^${studentData.firstName.trim()}$`, 'i') },
                dateOfBirth: studentData.dateOfBirth
            });

            if (hasSibling && studentData.phone) {
                username += studentData.phone.slice(-4);
            }
        }

        const student = await StudentRepository.create({
            ...studentData,
            schoolId: school._id,
            sessionId: activeSession._id,
            admissionNumber,
            username,
            status: StudentStatus.ACTIVE,
            isActive: true,
            password: defaultPassword,
            plainPassword: defaultPassword,
            mustChangePassword: true,
        } as any);

        await updateUsageForSchool(schoolId);
        return student;
    }

    /**
     * List students with pagination and filters
     */
    async listStudents(
        schoolId: string,
        query: { page?: number; limit?: number; search?: string; class?: string; section?: string; status?: string }
    ): Promise<{ students: IStudent[]; total: number; pages: number }> {
        const page = query.page || 1;
        const limit = query.limit || 50;
        const skip = (page - 1) * limit;

        // Standardized Tenant Filtering
        let filter = getTenantFilter(schoolId);

        if (query.class) filter.class = query.class;
        if (query.section) filter.section = query.section.toUpperCase();
        if (query.status) filter.status = query.status;

        if (query.search) {
            filter.$or = [
                { firstName: { $regex: query.search, $options: 'i' } },
                { lastName: { $regex: query.search, $options: 'i' } },
                { admissionNumber: { $regex: query.search, $options: 'i' } },
            ];
        }

        const result = await Student.find(filter)
            .sort({ class: 1, section: 1, rollNumber: 1 })
            .skip(skip)
            .limit(limit);

        const total = await Student.countDocuments(filter);

        return {
            students: result,
            total,
            pages: Math.ceil(total / limit),
        };
    }

    /**
     * Get student by ID
     */
    async getStudent(schoolId: string, id: string): Promise<IStudent> {
        const filter = getTenantFilter(schoolId, { _id: id });
        const student = await StudentRepository.findOne(filter);
        if (!student) {
            throw new ErrorResponse('Student not found', 404);
        }
        return student;
    }

    /**
     * Update student
     */
    async updateStudent(schoolId: string, id: string, data: Partial<IStudent>): Promise<IStudent> {
        const filter = getTenantFilter(schoolId, { _id: id });
        const student = await StudentRepository.findOne(filter);
        if (!student) {
            throw new ErrorResponse('Student not found', 404);
        }

        const updatedStudent = await StudentRepository.update(id, data);
        return updatedStudent!;
    }

    /**
     * Soft delete student
     */
    async deleteStudent(schoolId: string, id: string): Promise<void> {
        const filter = getTenantFilter(schoolId, { _id: id });
        const student = await StudentRepository.findOne(filter);
        if (!student) {
            throw new ErrorResponse('Student not found', 404);
        }

        // If student is in Class 12, mark as PASSED_OUT. Otherwise, delete permanently.
        const isClass12 = ['12', 'XII', '12th'].includes(student.class);

        if (isClass12) {
            await StudentRepository.update(id, {
                isActive: false,
                status: StudentStatus.PASSED_OUT,
            });
        } else {
            await StudentRepository.delete(id);
        }

        await updateUsageForSchool(schoolId);
    }

    /**
     * Generate Admission Number: {SCHOOL_CODE}{YY}{SEQUENCE}
     * e.g., DPS240001
     */
    private async generateAdmissionNumber(schoolId: string, schoolCode: string): Promise<string> {
        const year = new Date().getFullYear().toString().slice(-2);
        const prefix = `${schoolCode}${year}`;

        const lastStudent = await Student.findOne({
            schoolId,
            admissionNumber: { $regex: `^${prefix}`, $options: 'i' },
        }).sort({ admissionNumber: -1 });

        let sequence = 1;
        if (lastStudent) {
            const lastSequenceStr = lastStudent.admissionNumber.slice(prefix.length);
            const lastSequence = parseInt(lastSequenceStr, 10);
            if (!isNaN(lastSequence)) {
                sequence = lastSequence + 1;
            }
        }

        return `${prefix}${sequence.toString().padStart(4, '0')}`;
    }
}

export default new StudentService();
