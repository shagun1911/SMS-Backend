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
        // Count ALL staff roles (teacher + accountant + transport_manager + schooladmin)
        User.countDocuments({
            schoolId,
            role: {
                $in: [
                    UserRole.TEACHER,
                    UserRole.ACCOUNTANT,
                    UserRole.TRANSPORT_MANAGER,
                    UserRole.SCHOOL_ADMIN,
                    UserRole.BUS_DRIVER,
                    UserRole.CONDUCTOR,
                    UserRole.CLEANING_STAFF,
                    UserRole.STAFF_OTHER,
                ],
            },
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
