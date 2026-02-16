import Usage from '../models/usage.model';
import Student from '../models/student.model';
import User from '../models/user.model';
import { UserRole } from '../types';

/**
 * Recalculate and upsert usage (totalStudents, totalTeachers) for a school.
 * Call after student or teacher create/delete/status change.
 */
export async function updateUsageForSchool(schoolId: string): Promise<void> {
    const [totalStudents, totalTeachers] = await Promise.all([
        Student.countDocuments({ schoolId, isActive: true }),
        User.countDocuments({
            schoolId,
            role: UserRole.TEACHER,
            isActive: true,
        }),
    ]);
    await Usage.findOneAndUpdate(
        { schoolId },
        { totalStudents, totalTeachers, lastUpdated: new Date() },
        { upsert: true, new: true }
    );
}

export default { updateUsageForSchool };
