import StudentRepository from '../repositories/student.repository';
import SessionRepository from '../repositories/session.repository';
import ErrorResponse from '../utils/errorResponse';
import { StudentStatus } from '../types';

class PromotionService {
    /**
     * Batch Promote Students
     */
    async promoteStudents(
        schoolId: string,
        fromClass: string,
        toClass: string,
        newSessionId: string
    ): Promise<{ promoted: number; failed: number }> {
        // 1. Validate Target Session
        const newSession = await SessionRepository.findById(newSessionId);
        if (!newSession || !newSession.isActive) {
            throw new ErrorResponse('Target session is not active', 400);
        }

        // 2. Get Eligible Students
        const students = await StudentRepository.find({
            schoolId,
            class: fromClass,
            isActive: true, // Only active students
            status: StudentStatus.ACTIVE
        });

        let promotedCount = 0;

        // 3. Promote Logically
        for (const student of students) {
            // Prevent double promotion for same target session if needed?
            // But here we rely on the operator.

            // Update Student
            student.previousSchool = student.class; // Store history
            student.class = toClass;
            student.sessionId = newSession._id;
            student.status = StudentStatus.ACTIVE; // Remain active in new class

            await student.save();
            promotedCount++;
        }

        return { promoted: promotedCount, failed: 0 };
    }
}

export default new PromotionService();
