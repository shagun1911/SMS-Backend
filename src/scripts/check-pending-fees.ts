/**
 * Script to check why only some students show in pending fees
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import SchoolRepository from '../repositories/school.repository';
import SessionRepository from '../repositories/session.repository';
import StudentRepository from '../repositories/student.repository';
import StudentFee from '../models/studentFee.model';
import { Types } from 'mongoose';

dotenv.config();

async function checkPendingFees() {
    try {
        await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/sms');
        console.log('Connected to MongoDB');

        const schools = await SchoolRepository.find({});
        console.log(`Found ${schools.length} schools`);

        for (const school of schools) {
            const schoolId = school._id.toString();
            console.log(`\n=== School: ${school.schoolName} ===`);

            const session = await SessionRepository.findActive(schoolId);
            if (!session) {
                console.log('No active session found');
                continue;
            }

            console.log(`Active Session: ${session.sessionYear}`);
            console.log(`Start Date: ${session.startDate.toISOString()}`);
            console.log(`End Date: ${session.endDate.toISOString()}`);

            // Get session months
            const start = new Date(session.startDate);
            const end = new Date(session.endDate);
            const months: Array<{ year: number; month: number; monthName: string }> = [];
            const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

            let y = start.getFullYear();
            let m = start.getMonth() + 1;
            while (y < end.getFullYear() || (y === end.getFullYear() && m <= end.getMonth() + 1)) {
                months.push({ year: y, month: m, monthName: MONTHS[m - 1] });
                m++;
                if (m > 12) {
                    m = 1;
                    y++;
                }
            }

            console.log(`Session Months: ${months.map(m => `${m.monthName} ${m.year}`).join(', ')}`);

            // Check current month
            const today = new Date();
            const todayYear = today.getFullYear();
            const todayMonth = today.getMonth() + 1;
            const currentSessionMonth = months.find((m) => m.year === todayYear && m.month === todayMonth);
            console.log(`\nToday: ${today.toISOString()}`);
            console.log(`Current Month in Session: ${currentSessionMonth ? `${currentSessionMonth.monthName} ${currentSessionMonth.year}` : 'NOT IN SESSION'}`);

            // Get all active students
            const students = await StudentRepository.findActiveStudents(schoolId);
            console.log(`\nTotal Active Students: ${students.length}`);

            // Get fee ledger entries for current month
            if (currentSessionMonth) {
                const feeRecords = await StudentFee.find({
                    schoolId: new Types.ObjectId(schoolId),
                    sessionId: session._id,
                    month: currentSessionMonth.monthName,
                }).lean();

                console.log(`Fee records for ${currentSessionMonth.monthName}: ${feeRecords.length}`);

                const pendingRecords = feeRecords.filter((f: any) => 
                    (f.status || '').toString() !== 'paid' && (f.remainingAmount || 0) > 0
                );
                console.log(`Pending fee records: ${pendingRecords.length}`);

                // Get fee ledger entries for all months
                const allFeeRecords = await StudentFee.find({
                    schoolId: new Types.ObjectId(schoolId),
                    sessionId: session._id,
                }).lean();

                const monthCounts: Record<string, number> = {};
                allFeeRecords.forEach((f: any) => {
                    const month = f.month || 'unknown';
                    monthCounts[month] = (monthCounts[month] || 0) + 1;
                });

                console.log(`\nFee records by month:`);
                Object.entries(monthCounts).forEach(([month, count]) => {
                    console.log(`  ${month}: ${count} records`);
                });

                // Check which students don't have fee records for current month
                const studentIdsWithFees = new Set(feeRecords.map((f: any) => String(f.studentId)));
                const studentsWithoutFees = students.filter(s => !studentIdsWithFees.has(String(s._id)));
                console.log(`\nStudents without fee records for ${currentSessionMonth.monthName}: ${studentsWithoutFees.length}`);
                if (studentsWithoutFees.length > 0 && studentsWithoutFees.length <= 10) {
                    studentsWithoutFees.forEach(s => {
                        console.log(`  - ${s.admissionNumber} (Class ${s.class}, admitted: ${s.admissionDate})`);
                    });
                } else if (studentsWithoutFees.length > 10) {
                    console.log(`  (showing first 10)`);
                    studentsWithoutFees.slice(0, 10).forEach(s => {
                        console.log(`  - ${s.admissionNumber} (Class ${s.class}, admitted: ${s.admissionDate})`);
                    });
                }
            }
        }

        process.exit(0);
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}

checkPendingFees();
