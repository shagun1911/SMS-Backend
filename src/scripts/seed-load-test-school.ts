/**
 * Seed a load-test school with the biggest plan (250 teachers, 2500 students).
 * Use this to test MongoDB storage and system health in Master Admin.
 *
 * Run: npm run seed:load-test
 */

import dotenv from 'dotenv';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import config from '../config';
import User from '../models/user.model';
import School from '../models/school.model';
import Student from '../models/student.model';
import Session from '../models/session.model';
import Plan from '../models/plan.model';
import SchoolSubscription from '../models/schoolSubscription.model';
import { UserRole, Board, Gender, StudentStatus } from '../types';
import { updateUsageForSchool } from '../services/usage.service';
import { Types } from 'mongoose';

dotenv.config();

const PLAN_NAME = 'Ultimate';
const MAX_TEACHERS = 250;
const MAX_STUDENTS = 2500;
const BATCH_SIZE = 250;

// Indian first names (male/female) and surnames for realistic seed data
const FIRST_NAMES_M = ['Aarav', 'Arjun', 'Vikram', 'Rahul', 'Priyansh', 'Karan', 'Aditya', 'Rohan', 'Siddharth', 'Nikhil'];
const FIRST_NAMES_F = ['Ananya', 'Ishita', 'Kavya', 'Neha', 'Pooja', 'Riya', 'Sneha', 'Tanya', 'Urvashi', 'Vidya'];
const SURNAMES = ['Sharma', 'Singh', 'Patel', 'Kumar', 'Verma', 'Gupta', 'Reddy', 'Mehta', 'Joshi', 'Shah'];

const CLASSES = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];
const SECTIONS = ['A', 'B', 'C', 'D', 'E'];

function pick<T>(arr: T[]): T {
    return arr[Math.floor(Math.random() * arr.length)];
}

async function main() {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(config.mongodb.uri as string);
    console.log('✅ Connected\n');

    const schoolCode = 'LT-SCH';
    const schoolEmail = 'loadtest@loadtest.ssms.com';

    // Check if load-test school already exists
    const existing = await School.findOne({ schoolCode });
    if (existing) {
        console.log(`⚠️  Load-test school already exists: ${existing.schoolName} (${schoolCode})`);
        console.log('   Delete it first if you want to re-seed.');
        await mongoose.disconnect();
        process.exit(1);
    }

    // 1. Create or find Ultimate plan (250 teachers, 2500 students)
    let plan = await Plan.findOne({ name: PLAN_NAME });
    if (!plan) {
        console.log(`📋 Creating plan "${PLAN_NAME}" (${MAX_STUDENTS} students, ${MAX_TEACHERS} teachers)...`);
        plan = await Plan.create({
            name: PLAN_NAME,
            description: 'Load-test / biggest plan for storage testing',
            maxStudents: MAX_STUDENTS,
            maxTeachers: MAX_TEACHERS,
            priceMonthly: 14999,
            priceYearly: 149990,
            features: ['All features', 'Load test plan'],
            isActive: true,
            isDefault: false,
        });
        console.log(`   ✅ Plan created: ${plan._id}`);
    } else {
        console.log(`📋 Using existing plan: ${PLAN_NAME}`);
    }

    const schoolId = new Types.ObjectId();
    const adminId = new Types.ObjectId();

    // 2. Create School
    console.log('\n🏢 Creating school...');
    const school = await School.create({
        _id: schoolId,
        schoolName: 'Load Test Mega School',
        schoolCode,
        email: schoolEmail,
        phone: '+91 99999 00000',
        principalName: 'Principal Load Test',
        board: Board.CBSE,
        address: {
            street: '1 Load Test Avenue',
            city: 'Mumbai',
            state: 'Maharashtra',
            pincode: '400001',
            country: 'India',
        },
        classRange: { from: '1', to: '12' },
        subscriptionPlan: 'pro',
        isActive: true,
        studentLimit: MAX_STUDENTS,
        settings: { currency: 'INR', dateFormat: 'DD/MM/YYYY', timezone: 'Asia/Kolkata' },
        adminUserId: adminId,
    });
    console.log(`   ✅ School created: ${school.schoolName}`);

    // 3. Create active session
    const sessionYear = '2024-25';
    const session = await Session.create({
        schoolId: school._id,
        sessionYear,
        startDate: new Date('2024-04-01'),
        endDate: new Date('2025-03-31'),
        isActive: true,
    });
    console.log(`   ✅ Session created: ${sessionYear}`);

    // 4. Create School Admin
    await User.create({
        _id: adminId,
        schoolId: school._id,
        name: 'Load Test Admin',
        email: 'admin@loadtest.ssms.com',
        password: 'LoadTest@123',
        plainPassword: 'LoadTest@123',
        phone: '+91 99999 00001',
        role: UserRole.SCHOOL_ADMIN,
        isActive: true,
    });
    console.log('   ✅ School admin created');

    // 5. Create SchoolSubscription (assign biggest plan)
    const now = new Date();
    const subEnd = new Date(now.getFullYear() + 2, now.getMonth(), now.getDate());
    await SchoolSubscription.create({
        schoolId: school._id,
        planId: plan._id,
        subscriptionStart: now,
        subscriptionEnd: subEnd,
        status: 'active',
    });
    console.log(`   ✅ Subscription assigned: ${PLAN_NAME} until ${subEnd.toISOString().split('T')[0]}`);

    // 6. Create 249 teachers (1 admin already = 250 staff total)
    // Hash password once (insertMany bypasses pre-save hooks)
    const hashedPassword = await bcrypt.hash('LoadTest@123', 10);
    console.log(`\n👨‍🏫 Creating ${MAX_TEACHERS - 1} teachers...`);
    const teacherDocs = [];
    for (let i = 1; i < MAX_TEACHERS; i++) {
        const num = String(i).padStart(3, '0');
        const isFemale = i % 2 === 0;
        const firstName = pick(isFemale ? FIRST_NAMES_F : FIRST_NAMES_M);
        const lastName = pick(SURNAMES);
        teacherDocs.push({
            schoolId: school._id,
            name: `${firstName} ${lastName}`,
            email: `teacher_loadtest_${num}@loadtest.ssms.com`,
            password: hashedPassword,
            plainPassword: 'LoadTest@123',
            phone: `+91 9${String(900000000 + i).padStart(9, '0')}`,
            role: UserRole.TEACHER,
            subject: ['Mathematics', 'Science', 'English', 'Hindi', 'Social Studies'][i % 5],
            isActive: true,
        });
    }
    for (let i = 0; i < teacherDocs.length; i += BATCH_SIZE) {
        const batch = teacherDocs.slice(i, i + BATCH_SIZE);
        await User.insertMany(batch);
        process.stdout.write(`   Created ${Math.min(i + BATCH_SIZE, teacherDocs.length)}/${teacherDocs.length} teachers\r`);
    }
    console.log(`   ✅ ${MAX_TEACHERS - 1} teachers created`);

    // 7. Create 2500 students
    console.log(`\n👨‍🎓 Creating ${MAX_STUDENTS} students...`);
    const studentDocs = [];
    for (let i = 1; i <= MAX_STUDENTS; i++) {
        const admNo = `LT-${String(i).padStart(5, '0')}`;
        const isFemale = i % 3 === 0;
        const firstName = pick(isFemale ? FIRST_NAMES_F : FIRST_NAMES_M);
        const lastName = pick(SURNAMES);
        const cls = CLASSES[(i - 1) % CLASSES.length];
        const sec = SECTIONS[(i - 1) % SECTIONS.length];
        const year = 2010 - parseInt(cls, 10) + 5;
        studentDocs.push({
            schoolId: school._id,
            sessionId: session._id,
            admissionNumber: admNo,
            firstName,
            lastName,
            fatherName: `${pick(FIRST_NAMES_M)} ${lastName}`,
            motherName: `${pick(FIRST_NAMES_F)} ${lastName}`,
            dateOfBirth: new Date(year, (i % 12), 1 + (i % 28)),
            gender: isFemale ? Gender.FEMALE : Gender.MALE,
            phone: `+91 9${String(800000000 + (i % 100000000)).padStart(9, '0')}`,
            address: {
                street: `${i} Load Test Lane`,
                city: 'Mumbai',
                state: 'Maharashtra',
                pincode: '400001',
            },
            class: cls,
            section: sec,
            rollNumber: ((i - 1) % 50) + 1,
            status: StudentStatus.ACTIVE,
            isActive: true,
        });
    }
    for (let i = 0; i < studentDocs.length; i += BATCH_SIZE) {
        const batch = studentDocs.slice(i, i + BATCH_SIZE);
        await Student.insertMany(batch);
        process.stdout.write(`   Created ${Math.min(i + BATCH_SIZE, studentDocs.length)}/${studentDocs.length} students\r`);
    }
    console.log(`   ✅ ${MAX_STUDENTS} students created`);

    // 8. Update usage
    await updateUsageForSchool(school._id.toString());
    console.log('\n📊 Usage updated');

    console.log(`
╔══════════════════════════════════════════════════════════════╗
║  ✅ Load-test school seeded successfully!                    ║
╠══════════════════════════════════════════════════════════════╣
║  School: ${school.schoolName.padEnd(45)}║
║  Code:   ${schoolCode.padEnd(45)}║
║  Plan:   ${PLAN_NAME} (${MAX_STUDENTS} students, ${MAX_TEACHERS} teachers)`.padEnd(54) + `║
║                                                              ║
║  Admin:  admin@loadtest.ssms.com / LoadTest@123              ║
║  Teachers: teacher_loadtest_001@loadtest.ssms.com (etc.)     ║
║                                                              ║
║  Check Master Admin → System Health for MongoDB storage      ║
╚══════════════════════════════════════════════════════════════╝
`);

    await mongoose.disconnect();
    process.exit(0);
}

main().catch((err) => {
    console.error('❌ Seed failed:', err);
    process.exit(1);
});
