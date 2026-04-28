import dotenv from 'dotenv';
import mongoose from 'mongoose';
import config from '../config';
import School from '../models/school.model';
import Session from '../models/session.model';
import Class from '../models/class.model';
import FeeStructure from '../models/feeStructure.model';
import TransportDestination from '../models/transportDestination.model';
import Bus from '../models/bus.model';
import Student from '../models/student.model';
import StudentService from '../services/student.service';
import { Gender } from '../types';

dotenv.config();

const SEED_MARKER = 'AUTO_TEST_BATCH_2026';
const CLASSES = ['6', '7', '8', '9', '10'];
const SECTIONS = ['A', 'B'];
const STUDENTS_PER_CLASS = 15; // 5 classes x 15 = 75 students

const FIRST_NAMES_M = ['Aarav', 'Arjun', 'Vihaan', 'Kabir', 'Rohan', 'Yash', 'Krish', 'Ishaan'];
const FIRST_NAMES_F = ['Ananya', 'Diya', 'Kavya', 'Riya', 'Saanvi', 'Aadhya', 'Ira', 'Myra'];
const LAST_NAMES = ['Sharma', 'Verma', 'Singh', 'Patel', 'Yadav', 'Gupta', 'Joshi', 'Khan'];

type Args = {
    schoolQuery: string;
};

function parseArgs(): Args {
    const argv = process.argv.slice(2);
    let schoolQuery = 'shagun';

    for (let i = 0; i < argv.length; i++) {
        if ((argv[i] === '--school' || argv[i] === '-s') && argv[i + 1]) {
            schoolQuery = argv[i + 1].trim();
            i++;
        }
    }

    return { schoolQuery };
}

function pick<T>(arr: T[], idx: number): T {
    return arr[idx % arr.length];
}

function getSessionYearLabel(now = new Date()): string {
    const y = now.getFullYear();
    const m = now.getMonth();
    // Academic year starts from April
    return m >= 3 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
}

async function ensureActiveSession(schoolId: string) {
    let active = await Session.findOne({ schoolId, isActive: true });
    if (active) return active;

    const label = getSessionYearLabel();
    const startYear = Number(label.split('-')[0]);
    active = await Session.create({
        schoolId,
        sessionYear: label,
        startDate: new Date(startYear, 3, 1), // 1 Apr
        endDate: new Date(startYear + 1, 2, 31), // 31 Mar
        isActive: true,
    });
    return active;
}

async function ensureClasses(schoolId: string) {
    const classDocs: Array<{ className: string; section: string }> = [];
    for (const cls of CLASSES) {
        for (const sec of SECTIONS) {
            classDocs.push({ className: cls, section: sec });
        }
    }

    for (const c of classDocs) {
        await Class.findOneAndUpdate(
            { schoolId, className: c.className, section: c.section },
            {
                $setOnInsert: {
                    schoolId,
                    className: c.className,
                    section: c.section,
                    roomNumber: `${c.className}${c.section}-R`,
                    isActive: true,
                },
            },
            { upsert: true, new: true }
        );
    }
}

async function ensureTransport(schoolId: string) {
    const destinations = [
        { destinationName: 'Near Campus', monthlyFee: 0 },
        { destinationName: 'City Center', monthlyFee: 600 },
        { destinationName: 'Railway Colony', monthlyFee: 900 },
        { destinationName: 'Bus Stand', monthlyFee: 1100 },
        { destinationName: 'Model Town', monthlyFee: 1300 },
        { destinationName: 'Industrial Area', monthlyFee: 1500 },
        { destinationName: 'Outer Ring', monthlyFee: 1800 },
    ];

    const createdDestinations = [];
    for (const d of destinations) {
        const doc = await TransportDestination.findOneAndUpdate(
            { schoolId, destinationName: d.destinationName },
            {
                $set: {
                    monthlyFee: d.monthlyFee,
                    isActive: true,
                },
                $setOnInsert: {
                    schoolId,
                    destinationName: d.destinationName,
                },
            },
            { upsert: true, new: true }
        );
        createdDestinations.push(doc);
    }

    const buses = [
        { busNumber: 'BUS-06', registrationNumber: 'HR26AB1006', routeName: 'Route-6', capacity: 45 },
        { busNumber: 'BUS-07', registrationNumber: 'HR26AB1007', routeName: 'Route-7', capacity: 45 },
        { busNumber: 'BUS-08', registrationNumber: 'HR26AB1008', routeName: 'Route-8', capacity: 45 },
        { busNumber: 'BUS-09', registrationNumber: 'HR26AB1009', routeName: 'Route-9', capacity: 45 },
    ];

    const createdBuses = [];
    for (const b of buses) {
        const doc = await Bus.findOneAndUpdate(
            { schoolId, busNumber: b.busNumber },
            {
                $set: {
                    registrationNumber: b.registrationNumber,
                    routeName: b.routeName,
                    capacity: b.capacity,
                    isActive: true,
                },
                $setOnInsert: {
                    schoolId,
                    busNumber: b.busNumber,
                },
            },
            { upsert: true, new: true }
        );
        createdBuses.push(doc);
    }

    return { destinations: createdDestinations, buses: createdBuses };
}

async function ensureFeeStructures(schoolId: string, sessionId: string) {
    const structures = [
        {
            class: '6',
            components: [
                { name: 'Tuition Fee', amount: 2200, type: 'monthly' as const },
                { name: 'Computer Lab', amount: 300, type: 'monthly' as const },
                { name: 'Admission + Annual', amount: 4200, type: 'one-time' as const },
            ],
            feeExemptMonths: ['May'],
        },
        {
            class: '7',
            components: [
                { name: 'Tuition Fee', amount: 2400, type: 'monthly' as const },
                { name: 'Science Lab', amount: 350, type: 'monthly' as const },
                { name: 'Activity Fee', amount: 250, type: 'monthly' as const },
                { name: 'Annual Charges', amount: 4800, type: 'one-time' as const },
            ],
            feeExemptMonths: [],
        },
        {
            class: '8',
            components: [
                { name: 'Tuition Fee', amount: 2600, type: 'monthly' as const },
                { name: 'Digital Learning', amount: 400, type: 'monthly' as const },
                { name: 'Annual Charges', amount: 5200, type: 'one-time' as const },
            ],
            feeExemptMonths: ['June', 'December'],
        },
        {
            class: '9',
            components: [
                { name: 'Tuition Fee', amount: 2900, type: 'monthly' as const },
                { name: 'Board Prep', amount: 600, type: 'monthly' as const },
                { name: 'Lab Fee', amount: 450, type: 'monthly' as const },
                { name: 'Annual Charges', amount: 6000, type: 'one-time' as const },
            ],
            feeExemptMonths: ['May'],
        },
        {
            class: '10',
            components: [
                { name: 'Tuition Fee', amount: 3200, type: 'monthly' as const },
                { name: 'Board Prep', amount: 900, type: 'monthly' as const },
                { name: 'Practical + Annual', amount: 7500, type: 'one-time' as const },
            ],
            feeExemptMonths: [],
        },
    ];

    for (const s of structures) {
        await FeeStructure.findOneAndUpdate(
            { schoolId, sessionId, class: s.class },
            {
                $set: {
                    components: s.components,
                    feeExemptMonths: s.feeExemptMonths,
                    monthlyMultiplier: undefined,
                    isActive: true,
                },
                $setOnInsert: {
                    schoolId,
                    sessionId,
                    class: s.class,
                },
            },
            { upsert: true, new: true, runValidators: true }
        );
    }
}

async function createStudents(
    schoolId: string,
    destinations: Array<any>,
    buses: Array<any>
) {
    const existingSeededCount = await Student.countDocuments({ schoolId, previousSchool: SEED_MARKER });
    const target = CLASSES.length * STUDENTS_PER_CLASS;
    if (existingSeededCount >= target) {
        console.log(`ℹ️ Seed students already present (${existingSeededCount}). Skipping new student creation.`);
        return { created: 0, existingSeededCount };
    }

    let created = 0;
    const startIdx = existingSeededCount + 1;

    for (let idx = startIdx; idx <= target; idx++) {
        const classIndex = (idx - 1) % CLASSES.length;
        const cls = CLASSES[classIndex];
        const section = pick(SECTIONS, idx);
        const female = idx % 2 === 0;
        const firstName = female ? pick(FIRST_NAMES_F, idx) : pick(FIRST_NAMES_M, idx);
        const lastName = pick(LAST_NAMES, idx + 3);

        const transportMode = idx % 4; // 0 => no transport, others => varied destinations
        const usesTransport = transportMode !== 0;
        const destination = usesTransport ? destinations[idx % destinations.length] : null;
        const bus = usesTransport ? buses[idx % buses.length] : null;

        const concessionPercent = [0, 5, 10, 15, 20][idx % 5];
        const concessionAmount = idx % 6 === 0 ? 500 : idx % 9 === 0 ? 1000 : 0;

        const phoneTail = String(700000000 + idx).padStart(9, '0');
        const studentData = {
            firstName,
            lastName,
            fatherName: `${pick(FIRST_NAMES_M, idx + 2)} ${lastName}`,
            motherName: `${pick(FIRST_NAMES_F, idx + 5)} ${lastName}`,
            dateOfBirth: new Date(2011 - Number(cls), idx % 12, (idx % 27) + 1),
            gender: female ? Gender.FEMALE : Gender.MALE,
            phone: `+91 9${phoneTail}`,
            address: {
                street: `${idx} Test Street`,
                city: 'Narnaul',
                state: 'Haryana',
                pincode: '123001',
            },
            class: cls,
            section,
            rollNumber: ((idx - 1) % STUDENTS_PER_CLASS) + 1,
            usesTransport,
            transportDestinationId: destination?._id,
            busId: bus?._id,
            concessionPercent,
            concessionAmount,
            previousSchool: SEED_MARKER,
            initialDepositAmount: idx % 7 === 0 ? 1000 : 0,
            depositPaymentMode: idx % 2 === 0 ? 'upi' : 'cash',
        };

        await StudentService.createStudent(schoolId, studentData as any);
        created++;
        if (created % 10 === 0 || created === target - existingSeededCount) {
            process.stdout.write(`   Created ${created}/${target - existingSeededCount} students\r`);
        }
    }
    process.stdout.write('\n');

    return { created, existingSeededCount };
}

async function main() {
    const { schoolQuery } = parseArgs();

    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(config.mongodb.uri as string);
    console.log('✅ Connected');

    const school = await School.findOne({
        $or: [
            { schoolName: new RegExp(`^${schoolQuery}$`, 'i') },
            { schoolCode: new RegExp(`^${schoolQuery}$`, 'i') },
        ],
    });

    if (!school) {
        throw new Error(`School not found for query "${schoolQuery}"`);
    }

    console.log(`🏫 Using school: ${school.schoolName} (${school.schoolCode})`);
    const session = await ensureActiveSession(String(school._id));
    console.log(`📅 Active session: ${session.sessionYear}`);

    await ensureClasses(String(school._id));
    console.log(`🏷️ Ensured classes: ${CLASSES.join(', ')} with sections ${SECTIONS.join(', ')}`);

    const { destinations, buses } = await ensureTransport(String(school._id));
    console.log(`🚌 Ensured transport destinations: ${destinations.length}, buses: ${buses.length}`);

    await ensureFeeStructures(String(school._id), String(session._id));
    console.log(`💰 Ensured fee structures for classes: ${CLASSES.join(', ')}`);

    const result = await createStudents(String(school._id), destinations, buses);
    const totalSeeded = await Student.countDocuments({ schoolId: school._id, previousSchool: SEED_MARKER });

    console.log('\n✅ School testing data prepared');
    console.log(`   New students created: ${result.created}`);
    console.log(`   Seed marker students total: ${totalSeeded}`);
    console.log(`   Marker used: ${SEED_MARKER}`);

    await mongoose.disconnect();
}

main().catch(async (err) => {
    console.error('❌ Seed failed:', err);
    try {
        await mongoose.disconnect();
    } catch {
        // ignore
    }
    process.exit(1);
});

