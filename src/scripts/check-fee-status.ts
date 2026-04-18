/**
 * Script to check fee status for April
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import SchoolRepository from '../repositories/school.repository';
import SessionRepository from '../repositories/session.repository';
import StudentFee from '../models/studentFee.model';
import Student from '../models/student.model';
import { Types } from 'mongoose';

dotenv.config();

async function checkFeeStatus() {
    try {
        await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/sms');
        console.log('Connected to MongoDB');

        const schools = await SchoolRepository.find({});
        
        for (const school of schools) {
            const schoolId = school._id.toString();
            console.log(`\n=== School: ${school.schoolName} ===`);

            const session = await SessionRepository.findActive(schoolId);
            if (!session) continue;

            const feeRecords = await StudentFee.find({
                schoolId: new Types.ObjectId(schoolId),
                sessionId: session._id,
                month: 'April',
            }).lean();

            console.log(`Total April fee records: ${feeRecords.length}`);

            const statusCounts: Record<string, number> = {};
            feeRecords.forEach((f: any) => {
                const status = f.status || 'unknown';
                statusCounts[status] = (statusCounts[status] || 0) + 1;
            });

            console.log(`Fee status breakdown:`);
            Object.entries(statusCounts).forEach(([status, count]) => {
                console.log(`  ${status}: ${count}`);
            });

            // Check records with paidAmount > 0
            const withPayment = feeRecords.filter((f: any) => (f.paidAmount || 0) > 0);
            console.log(`\nRecords with paidAmount > 0: ${withPayment.length}`);
            if (withPayment.length > 0 && withPayment.length <= 5) {
                withPayment.forEach(f => {
                    console.log(`  - StudentId: ${f.studentId}, Paid: ${f.paidAmount}, Remaining: ${f.remainingAmount}, Status: ${f.status}`);
                });
            } else if (withPayment.length > 5) {
                console.log(`  (showing first 5)`);
                withPayment.slice(0, 5).forEach(f => {
                    console.log(`  - StudentId: ${f.studentId}, Paid: ${f.paidAmount}, Remaining: ${f.remainingAmount}, Status: ${f.status}`);
                });
            }

            // Check records with remainingAmount = 0
            const zeroRemaining = feeRecords.filter((f: any) => (f.remainingAmount || 0) === 0);
            console.log(`\nRecords with remainingAmount = 0: ${zeroRemaining.length}`);

            // Get student info for records with issues
            const problematicRecords = feeRecords.filter((f: any) => 
                (f.status || '').toString() === 'paid' || (f.remainingAmount || 0) === 0
            );
            
            if (problematicRecords.length > 0) {
                console.log(`\nProblematic records (paid or zero remaining): ${problematicRecords.length}`);
                const studentIds = problematicRecords.map(f => f.studentId);
                const students = await Student.find({
                    schoolId: new Types.ObjectId(schoolId),
                    _id: { $in: studentIds }
                }).lean();

                const studentMap = new Map(students.map(s => [String(s._id), s]));
                
                console.log(`(showing first 10)`);
                problematicRecords.slice(0, 10).forEach(f => {
                    const s = studentMap.get(String(f.studentId));
                    console.log(`  - ${s?.admissionNumber}: Status=${f.status}, Paid=${f.paidAmount}, Remaining=${f.remainingAmount}, Total=${f.totalAmount}`);
                });
            }
        }

        process.exit(0);
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}

checkFeeStatus();
