/**
 * Erase the load-test school (LT-SCH) and all its related data.
 * Also reports capacity: how many such schools fit in 512 MB MongoDB free tier.
 *
 * Run: npm run seed:erase-load-test
 */

import dotenv from 'dotenv';
import mongoose from 'mongoose';
import config from '../config';
import User from '../models/user.model';
import School from '../models/school.model';
import Student from '../models/student.model';
import Session from '../models/session.model';
import SchoolSubscription from '../models/schoolSubscription.model';
import Usage from '../models/usage.model';
import FeePayment from '../models/feePayment.model';
import StudentFee from '../models/studentFee.model';
import FeeStructure from '../models/feeStructure.model';
import Exam from '../models/exam.model';
import ExamResult from '../models/examResult.model';
import Class from '../models/class.model';
import Bus from '../models/bus.model';
import Notification from '../models/notification.model';
import Homework from '../models/homework.model';
import Timetable from '../models/timetable.model';
import TimetableSettings from '../models/timetableSettings.model';
import TimetableVersion from '../models/timetableVersion.model';
import SchoolTimetableGrid from '../models/schoolTimetableGrid.model';
import Salary from '../models/salary.model';
import SalaryStructure from '../models/salaryStructure.model';
import OtherPayment from '../models/otherPayment.model';
import UserNotification from '../models/userNotification.model';
import SupportTicket from '../models/supportTicket.model';

dotenv.config();

const SCHOOL_CODE = 'LT-SCH';
const FREE_TIER_MB = 512;

async function getDbStats() {
    const db = mongoose.connection.db!;
    const stats: any = await db.command({ dbStats: 1, scale: 1024 * 1024 });
    // With scale 1024*1024, dataSize/indexSize are already in MB
    const dataMB = parseFloat((stats.dataSize || 0).toFixed(2));
    const indexMB = parseFloat((stats.indexSize || 0).toFixed(2));
    const totalMB = parseFloat((dataMB + indexMB).toFixed(2));
    return { dataMB, indexMB, totalMB, objects: stats.objects ?? 0 };
}

async function main() {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(config.mongodb.uri as string);
    console.log('✅ Connected\n');

    const school = await School.findOne({ schoolCode: SCHOOL_CODE });
    if (!school) {
        console.log(`⚠️  No load-test school found (code: ${SCHOOL_CODE}). Nothing to erase.`);
        await mongoose.disconnect();
        process.exit(0);
    }

    const schoolId = school._id;
    console.log(`📋 Found load-test school: ${school.schoolName} (${schoolId})\n`);

    // Get size BEFORE deletion
    const statsBefore = await getDbStats();
    console.log(`📊 Database BEFORE deletion: ${statsBefore.totalMB.toFixed(2)} MB total (${statsBefore.dataMB.toFixed(2)} MB data + ${statsBefore.indexMB.toFixed(2)} MB indexes)\n`);

    // Delete in order (child collections first)
    const collections = [
        { name: 'FeePayment', model: FeePayment },
        { name: 'StudentFee', model: StudentFee },
        { name: 'ExamResult', model: ExamResult },
        { name: 'Exam', model: Exam },
        { name: 'Homework', model: Homework },
        { name: 'Timetable', model: Timetable },
        { name: 'TimetableSettings', model: TimetableSettings },
        { name: 'TimetableVersion', model: TimetableVersion },
        { name: 'SchoolTimetableGrid', model: SchoolTimetableGrid },
        { name: 'Salary', model: Salary },
        { name: 'OtherPayment', model: OtherPayment },
        { name: 'SalaryStructure', model: SalaryStructure },
        { name: 'FeeStructure', model: FeeStructure },
        { name: 'Notification', model: Notification },
        { name: 'UserNotification', model: UserNotification },
        { name: 'SupportTicket', model: SupportTicket },
        { name: 'Class', model: Class },
        { name: 'Bus', model: Bus },
        { name: 'Student', model: Student },
        { name: 'Session', model: Session },
        { name: 'SchoolSubscription', model: SchoolSubscription },
        { name: 'Usage', model: Usage },
        { name: 'User', model: User },
        { name: 'School', model: School },
    ];

    console.log('🗑️  Deleting load-test school data...\n');
    for (const { name, model } of collections) {
        const filter = name === 'School' ? { _id: schoolId } : { schoolId };
        const res = await model.deleteMany(filter);
        if (res.deletedCount > 0) {
            console.log(`   ${name}: ${res.deletedCount} deleted`);
        }
    }

    // Delete Ultimate plan if it was created for load-test (optional - keeps plan for future use)
    // Skipping Plan deletion - plan can be reused

    // Get size AFTER deletion
    const statsAfter = await getDbStats();
    const freedMB = statsBefore.totalMB - statsAfter.totalMB;

    console.log(`\n📊 Database AFTER deletion: ${statsAfter.totalMB.toFixed(2)} MB total`);
    console.log(`   Freed: ${freedMB.toFixed(2)} MB\n`);

    // Capacity calculation
    const sizePerSchoolMB = Math.max(freedMB, 0.5); // floor at 0.5 MB for division
    const maxSchools = Math.floor(FREE_TIER_MB / sizePerSchoolMB);

    // Reserve ~20% for system overhead, indexes, Plans, master admin, etc.
    const usableMB = FREE_TIER_MB * 0.8;
    const conservativeMaxSchools = Math.floor(usableMB / sizePerSchoolMB);

    // Fully used school (receipts, fee payments, student fees, exams, etc.) ~2-3x basic
    const fullyUsedMultiplier = 2.5;
    const sizeFullyUsedMB = sizePerSchoolMB * fullyUsedMultiplier;
    const maxSchoolsFullyUsed = Math.floor(usableMB / sizeFullyUsedMB);

    console.log(`
╔══════════════════════════════════════════════════════════════════════════╗
║  📈 MONGODB 512 MB FREE TIER – SCHOOL CAPACITY ESTIMATE                  ║
╠══════════════════════════════════════════════════════════════════════════╣
║  Per school (2500 students + 250 teachers):                              ║
║    • Measured (basic records only):  ~${freedMB.toFixed(1).padStart(4)} MB                                   ║
║    • Estimated (fully used*):        ~${sizeFullyUsedMB.toFixed(1).padStart(4)} MB                                   ║
║                                                                          ║
║  MINIMAL data (no fees/receipts/exams):                                  ║
║    • Max schools (full 512 MB):      ~${String(maxSchools).padStart(3)} schools                                    ║
║    • Conservative (80% usable**):    ~${String(conservativeMaxSchools).padStart(3)} schools                                    ║
║                                                                          ║
║  FULLY USED* (receipts, fees, exams, timetables, etc.):                  ║
║    • Conservative estimate:          ~${String(maxSchoolsFullyUsed).padStart(3)} schools                                    ║
║                                                                          ║
║  * Fully used = fee payments, student fees, exam results, timetables,    ║
║    salary records, etc. (PDF receipts stored on disk/Cloudinary)         ║
║  ** 20% reserved for: Plans, super admin, system collections, overhead   ║
╚══════════════════════════════════════════════════════════════════════════╝
`);

    await mongoose.disconnect();
    process.exit(0);
}

main().catch((err) => {
    console.error('❌ Erase failed:', err);
    process.exit(1);
});
