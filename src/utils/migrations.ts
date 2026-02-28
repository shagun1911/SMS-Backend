import Student from '../models/student.model';

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
        // For each student, check if they have a "sibling" (same name and DOB) in the same school
        for (const student of allStudents) {
            try {
                let changed = false;
                const firstNameLower = student.firstName.trim().toLowerCase();
                const phoneSuffix = (student as any).phone ? (student as any).phone.slice(-4) : '';

                // Check for OTHER students with SAME name and SAME DOB
                const hasSibling = allStudents.some(s =>
                    s._id.toString() !== student._id.toString() &&
                    s.schoolId.toString() === student.schoolId.toString() &&
                    s.firstName.trim().toLowerCase() === firstNameLower &&
                    new Date(s.dateOfBirth).getTime() === new Date(student.dateOfBirth).getTime()
                );

                const targetUsername = hasSibling ? (firstNameLower + phoneSuffix) : firstNameLower;

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
