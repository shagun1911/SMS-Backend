import Student from '../models/student.model';
import { buildStudentUsernameBase, ensureUniqueStudentUsername } from './studentUsername';

/**
 * Migration: Populate missing usernames for students
 * Only fetches students that actually need migration (missing username or plainPassword).
 * Uses targeted queries instead of fetching all students.
 */
export async function migrateStudentUsernames() {
    try {
        console.log('🔄 Checking for students with missing usernames...');

        // Only fetch students that actually need migration
        const studentsToMigrate = await Student.find({
            $or: [
                { username: { $exists: false } },
                { username: '' },
                { username: null },
                { plainPassword: { $exists: false } },
                { plainPassword: '' },
                { plainPassword: null },
            ]
        });

        if (studentsToMigrate.length === 0) {
            console.log('✅ No students need username/password migration.');
            return;
        }

        console.log(`📝 Migrating ${studentsToMigrate.length} students with missing username/password...`);

        let updatedCount = 0;
        for (const student of studentsToMigrate) {
            try {
                let changed = false;
                const base = buildStudentUsernameBase(
                    student.firstName,
                    (student as any).phone,
                    student.admissionNumber
                );
                const targetUsername = await ensureUniqueStudentUsername(base, student._id);

                if (student.username !== targetUsername) {
                    student.username = targetUsername;
                    changed = true;
                }

                // Set plainPassword to DOB default if missing
                if (!student.plainPassword && student.dateOfBirth) {
                    const dob = new Date((student as any).dateOfBirth);
                    const dd = String(dob.getDate()).padStart(2, '0');
                    const mm = String(dob.getMonth() + 1).padStart(2, '0');
                    const yyyy = dob.getFullYear();
                    student.plainPassword = `${dd}${mm}${yyyy}`;
                    changed = true;
                }

                if (changed) {
                    await student.save({ validateBeforeSave: false });
                    updatedCount++;
                }
            } catch (err: any) {
                console.error(`❌ Failed to update student ${student.admissionNumber}: ${err.message}`);
            }
        }
        console.log(`✅ Migration complete. Updated ${updatedCount} students.`);
    } catch (error: any) {
        console.error('❌ Error during student username migration:', error.message);
    }
}
