import Student from '../models/student.model';
import { buildStudentUsernameBase, ensureUniqueStudentUsername } from './studentUsername';

/**
 * Migration: Populate missing usernames for students
 * This finds all students where username is missing and sets it to their firstName (lowercase)
 */
export async function migrateStudentUsernames() {
    try {
        console.log('🔄 Checking for students with missing usernames...');

        // Find students who don't have a username OR plainPassword field set
        // OR if username is just the firstName (needs phone suffix for uniqueness)
        const allStudents = await Student.find({});

        console.log(`📝 Checking ${allStudents.length} students for username/password consistency...`);

        let updatedCount = 0;
        for (const student of allStudents) {
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

        console.log(`✅ Successfully migrated ${updatedCount} students.`);
    } catch (error: any) {
        console.error('❌ Error during student username migration:', error.message);
    }
}
