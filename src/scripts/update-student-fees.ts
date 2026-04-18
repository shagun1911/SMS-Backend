/**
 * Script to update existing students' totalYearlyFee and create fee ledger entries
 * Run this after creating fee structures to ensure all students have their fees set correctly
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import SchoolRepository from '../repositories/school.repository';
import StudentRepository from '../repositories/student.repository';
import SessionRepository from '../repositories/session.repository';
import FeeStructureRepository from '../repositories/feeStructure.repository';
import StudentFeeRepository from '../repositories/studentFee.repository';
import StudentFee from '../models/studentFee.model';
import { Types } from 'mongoose';
import { FeeStatus } from '../types';

dotenv.config();

// Helper function to get session months
function getSessionYearMonths(session: any): Array<{ year: number; month: number; monthName: string }> {
    const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const start = new Date(session.startDate);
    const end = new Date(session.endDate);
    const result: Array<{ year: number; month: number; monthName: string }> = [];

    let y = start.getFullYear();
    let m = start.getMonth() + 1; // 1-based
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

// Helper function to create fee ledger entries for a student
async function ensureStudentFeeLedger(schoolId: string, student: any, session: any, structure: any): Promise<void> {
    const rawItems: Array<{ title?: string; name?: string; amount: number; type?: string }> =
        (structure as any).components && (structure as any).components.length > 0
            ? (structure as any).components
            : ((structure as any).fees || []).map((f: any) => ({
                  title: f.title,
                  amount: f.amount,
                  type: f.type,
              }));

    const monthlyItems = rawItems.filter((x: any) => (x.type || '').toString().toLowerCase() === 'monthly');
    const oneTimeItems = rawItems.filter((x: any) => {
        const t = (x.type || '').toString().toLowerCase();
        return t === 'one-time' || t === 'one_time' || t === 'one time';
    });

    const monthlyTotal = monthlyItems.reduce((sum: number, x: any) => sum + (Number(x.amount) || 0), 0);
    const oneTimeTotal = oneTimeItems.reduce((sum: number, x: any) => sum + (Number(x.amount) || 0), 0);

    const months = getSessionYearMonths(session);
    const sessionMonthCount = months.length || 12;

    // Apply student-level concession to monthly fee only
    const annualRecurring = monthlyTotal * sessionMonthCount;
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

    // Monthly ledger entries
    let idx = 0;
    for (const m of months) {
        const adjustedMonthlyPerMonth = idx < remainder ? basePerMonth + 1 : basePerMonth;
        idx++;
        const existing = await StudentFeeRepository.findByStudentMonth(schoolId, student._id.toString(), session._id.toString(), m.monthName);
        if (existing) continue;
        await StudentFeeRepository.create({
            schoolId: new Types.ObjectId(schoolId) as any,
            studentId: student._id,
            sessionId: session._id,
            month: m.monthName,
            feeBreakdown: monthlyItems.map((f: any) => ({
                title: f.title || f.name || 'Monthly Fee',
                amount: Number(f.amount) || 0,
                type: 'monthly',
            })),
            totalAmount: adjustedMonthlyPerMonth,
            paidAmount: 0,
            remainingAmount: adjustedMonthlyPerMonth,
            status: FeeStatus.PENDING,
            dueDate: new Date(m.year, m.month, 0, 23, 59, 59),
            payments: [],
            discount: 0,
            lateFee: 0,
        } as any);
    }

    // One-time ledger entry
    if (oneTimeTotal > 0) {
        const existing = await StudentFeeRepository.findByStudentMonth(schoolId, student._id.toString(), session._id.toString(), 'One-Time');
        if (!existing) {
            await StudentFeeRepository.create({
                schoolId: new Types.ObjectId(schoolId) as any,
                studentId: student._id,
                sessionId: session._id,
                month: 'One-Time',
                feeBreakdown: oneTimeItems.map((f: any) => ({
                    title: f.title || f.name || 'One-Time Fee',
                    amount: Number(f.amount) || 0,
                    type: 'one-time',
                })),
                totalAmount: oneTimeTotal,
                paidAmount: 0,
                remainingAmount: oneTimeTotal,
                status: FeeStatus.PENDING,
                dueDate: new Date(session.startDate),
                payments: [],
                discount: 0,
                lateFee: 0,
            } as any);
        }
    }
}

async function updateStudentFees() {
    try {
        await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/sms');
        console.log('Connected to MongoDB');

        // Get all schools
        const schools = await SchoolRepository.find({});
        console.log(`Found ${schools.length} schools`);

        let totalFeeUpdated = 0;
        let totalLedgerCreated = 0;
        let totalPaidSynced = 0;

        for (const school of schools) {
            const schoolId = school._id.toString();
            console.log(`\nProcessing school: ${school.schoolName}`);

            // Get active session
            const activeSession = await SessionRepository.findActive(schoolId);
            if (!activeSession) {
                console.log(`  No active session found for school ${school.schoolName}`);
                continue;
            }

            console.log(`  Active session: ${activeSession.sessionYear}`);

            // Get all active students
            const students = await StudentRepository.findActiveStudents(schoolId);
            console.log(`  Found ${students.length} active students`);

            for (const student of students) {
                const studentClass = student.class;
                const studentId = student._id.toString();

                // Find fee structure for this class
                let structure = await FeeStructureRepository.findByClass(
                    schoolId,
                    activeSession._id.toString(),
                    studentClass
                );

                // Try without section if not found
                if (!structure && typeof studentClass === 'string' && studentClass.includes(' ')) {
                    structure = await FeeStructureRepository.findByClass(
                        schoolId,
                        activeSession._id.toString(),
                        studentClass.split(' ')[0]
                    );
                }

                if (!structure) {
                    console.log(`    No fee structure found for class ${studentClass}`);
                    continue;
                }

                // Calculate total yearly fee
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

                // Calculate session months (default to 12)
                const sessionMonths = 12;
                const annualRecurring = monthlyTotal * sessionMonths;
                const totalYearly = annualRecurring + oneTimeTotal;

                // Update student's totalYearlyFee if not set
                if (!student.totalYearlyFee || student.totalYearlyFee <= 0) {
                    await StudentRepository.update(studentId, {
                        totalYearlyFee: totalYearly,
                        dueAmount: totalYearly,
                        paidAmount: 0,
                    } as any);
                    totalFeeUpdated++;
                    console.log(`    Updated fee for student ${student.admissionNumber} (Class ${studentClass}): ₹${totalYearly}`);
                }

                // Create fee ledger entries if they don't exist
                const existingLedger = await StudentFee.find({
                    schoolId: new Types.ObjectId(schoolId),
                    studentId: student._id,
                    sessionId: activeSession._id,
                });
                if (existingLedger.length === 0) {
                    await ensureStudentFeeLedger(schoolId, student, activeSession, structure);
                    totalLedgerCreated++;
                    console.log(`    Created ledger for student ${student.admissionNumber}`);
                }

                // Sync paidAmount from ledger if student has payments
                if ((student.paidAmount || 0) > 0) {
                    const ledgerTotalPaid = existingLedger.reduce((sum: number, f: any) => sum + (f.paidAmount || 0), 0);
                    if (ledgerTotalPaid !== (student.paidAmount || 0)) {
                        const due = totalYearly - ledgerTotalPaid;
                        await StudentRepository.update(studentId, {
                            paidAmount: ledgerTotalPaid,
                            dueAmount: due,
                        } as any);
                        totalPaidSynced++;
                        console.log(`    Synced paid amount for student ${student.admissionNumber}: ₹${ledgerTotalPaid} paid, ₹${due} due`);
                    }
                }
            }

            console.log(`  School summary: ${totalFeeUpdated} fee updates, ${totalLedgerCreated} ledgers created, ${totalPaidSynced} payments synced`);
        }

        console.log(`\n✅ Total updates:`);
        console.log(`   - Fee amounts updated: ${totalFeeUpdated}`);
        console.log(`   - Fee ledgers created: ${totalLedgerCreated}`);
        console.log(`   - Payments synced: ${totalPaidSynced}`);
        process.exit(0);
    } catch (error) {
        console.error('Error updating student fees:', error);
        process.exit(1);
    }
}

updateStudentFees();
