/**
 * Script to fix fee ledger entries with zero amounts
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import SchoolRepository from '../repositories/school.repository';
import SessionRepository from '../repositories/session.repository';
import FeeStructureRepository from '../repositories/feeStructure.repository';
import StudentFee from '../models/studentFee.model';
import Student from '../models/student.model';
import StudentFeeRepository from '../repositories/studentFee.repository';
import { Types } from 'mongoose';
import { FeeStatus } from '../types';

dotenv.config();

function getSessionYearMonths(session: any): Array<{ year: number; month: number; monthName: string }> {
    const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const start = new Date(session.startDate);
    const end = new Date(session.endDate);
    const result: Array<{ year: number; month: number; monthName: string }> = [];

    let y = start.getFullYear();
    let m = start.getMonth() + 1;
    while (y < end.getFullYear() || (y === end.getFullYear() && m <= end.getMonth() + 1)) {
        result.push({ year: y, month: m, monthName: MONTHS[m - 1] });
        m++;
        if (m > 12) {
            m = 1;
            y++;
        }
    }
    return result;
}

async function fixZeroFeeLedger() {
    try {
        await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/sms');
        console.log('Connected to MongoDB');

        const schools = await SchoolRepository.find({});
        
        for (const school of schools) {
            const schoolId = school._id.toString();
            console.log(`\n=== School: ${school.schoolName} ===`);

            const session = await SessionRepository.findActive(schoolId);
            if (!session) continue;

            // Find students with zero-amount fee records
            const zeroFeeRecords = await StudentFee.find({
                schoolId: new Types.ObjectId(schoolId),
                sessionId: session._id,
                totalAmount: 0,
            }).lean();

            if (zeroFeeRecords.length === 0) {
                console.log('No zero-amount fee records found');
                continue;
            }

            console.log(`Found ${zeroFeeRecords.length} zero-amount fee records`);

            const studentIds = Array.from(new Set(zeroFeeRecords.map((f: any) => String(f.studentId))));
            const students = await Student.find({
                schoolId: new Types.ObjectId(schoolId),
                _id: { $in: studentIds },
            }).lean();

            let fixedCount = 0;

            for (const student of students) {
                const studentClass = student.class;
                const studentId = student._id.toString();

                // Find fee structure
                let structure = await FeeStructureRepository.findByClass(
                    schoolId,
                    session._id.toString(),
                    studentClass
                );

                if (!structure && typeof studentClass === 'string' && studentClass.includes(' ')) {
                    structure = await FeeStructureRepository.findByClass(
                        schoolId,
                        session._id.toString(),
                        studentClass.split(' ')[0]
                    );
                }

                if (!structure) {
                    console.log(`  No fee structure for student ${student.admissionNumber} (Class ${studentClass})`);
                    continue;
                }

                // Calculate fees
                const rawItems: Array<{ amount: number; type?: string }> =
                    (structure as any).components && (structure as any).components.length > 0
                        ? (structure as any).components
                        : ((structure as any).fees || []).map((f: any) => ({
                              amount: f.amount,
                              type: f.type,
                          }));

                let monthlyTotal = 0;
                let oneTimeTotal = 0;
                for (const item of rawItems) {
                    if (!item || typeof item.amount !== 'number') continue;
                    const t = (item.type || '').toString().toLowerCase();
                    if (t === 'one-time' || t === 'one_time' || t === 'one time') {
                        oneTimeTotal += item.amount;
                    } else if (t === 'monthly') {
                        monthlyTotal += item.amount;
                    }
                }

                if (monthlyTotal === 0 && oneTimeTotal === 0) {
                    console.log(`  Zero fee amounts in structure for student ${student.admissionNumber}`);
                    continue;
                }

                const months = getSessionYearMonths(session);
                const sessionMonthCount = months.length || 12;
                const annualRecurring = monthlyTotal * sessionMonthCount;

                // Apply concession
                const flatConcession = Math.max(0, Math.round(Number(student?.concessionAmount) || 0));
                const pctConcession = Math.min(100, Math.max(0, Number(student?.concessionPercent) || 0));
                const fromPct = pctConcession > 0 ? Math.round((annualRecurring * pctConcession) / 100) : 0;
                const concession = Math.min(annualRecurring, flatConcession + fromPct);

                const annualMonthlyAfter = concession > 0 && monthlyTotal > 0
                    ? Math.max(0, annualRecurring - concession)
                    : annualRecurring;

                const annualMonthlyAfterInt = Math.round(annualMonthlyAfter);
                const basePerMonth = sessionMonthCount > 0
                    ? Math.floor(annualMonthlyAfterInt / sessionMonthCount)
                    : annualMonthlyAfterInt;
                const remainder = sessionMonthCount > 0
                    ? annualMonthlyAfterInt - (basePerMonth * sessionMonthCount)
                    : 0;

                // Update monthly fee records
                let idx = 0;
                for (const m of months) {
                    const adjustedMonthlyPerMonth = idx < remainder ? basePerMonth + 1 : basePerMonth;
                    idx++;

                    const existing = await StudentFeeRepository.findByStudentMonth(
                        schoolId,
                        studentId,
                        session._id.toString(),
                        m.monthName
                    );

                    if (existing && existing.totalAmount === 0) {
                        await StudentFeeRepository.update(existing._id.toString(), {
                            totalAmount: adjustedMonthlyPerMonth,
                            paidAmount: 0,
                            remainingAmount: adjustedMonthlyPerMonth,
                            status: FeeStatus.PENDING,
                        } as any);
                        fixedCount++;
                    }
                }

                // Update one-time fee record
                if (oneTimeTotal > 0) {
                    const existing = await StudentFeeRepository.findByStudentMonth(
                        schoolId,
                        studentId,
                        session._id.toString(),
                        'One-Time'
                    );

                    if (existing && existing.totalAmount === 0) {
                        await StudentFeeRepository.update(existing._id.toString(), {
                            totalAmount: oneTimeTotal,
                            paidAmount: 0,
                            remainingAmount: oneTimeTotal,
                            status: FeeStatus.PENDING,
                        } as any);
                        fixedCount++;
                    }
                }

                console.log(`  Fixed fee records for student ${student.admissionNumber}`);
            }

            console.log(`Total fixed: ${fixedCount} fee records`);
        }

        console.log('\n✅ Fix completed');
        process.exit(0);
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}

fixZeroFeeLedger();
