/**
 * Debug script to check fee structure data
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import SchoolRepository from '../repositories/school.repository';
import SessionRepository from '../repositories/session.repository';
import FeeStructure from '../models/feeStructure.model';
import { Types } from 'mongoose';

dotenv.config();

async function debugFeeStructure() {
    try {
        await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/sms');
        console.log('Connected to MongoDB');

        const schools = await SchoolRepository.find({});

        for (const school of schools) {
            const schoolId = school._id.toString();
            console.log(`\n=== School: ${school.schoolName} ===`);

            const session = await SessionRepository.findActive(schoolId);
            if (!session) continue;

            // Get all fee structures
            const structures = await FeeStructure.find({
                schoolId: new Types.ObjectId(schoolId),
                sessionId: session._id,
            }).lean();

            console.log(`Fee structures: ${structures.length}`);
            for (const s of structures) {
                console.log(`\n  Class: ${s.class}`);
                console.log(`  totalAmount: ${s.totalAmount}`);
                console.log(`  totalAnnualFee: ${s.totalAnnualFee}`);
                console.log(`  components: ${JSON.stringify(s.components, null, 2)}`);
                console.log(`  fees: ${JSON.stringify((s as any).fees, null, 2)}`);

                // Test the parsing logic
                const rawItems: Array<{ amount: number; type?: string }> =
                    (s as any).components && (s as any).components.length > 0
                        ? (s as any).components
                        : ((s as any).fees || []).map((f: any) => ({
                              amount: f.amount,
                              type: f.type,
                          }));

                console.log(`  rawItems parsed: ${JSON.stringify(rawItems, null, 2)}`);

                let monthlyTotal = 0;
                let oneTimeTotal = 0;
                for (const item of rawItems) {
                    if (!item || typeof item.amount !== 'number') {
                        console.log(`    SKIPPING item: ${JSON.stringify(item)} (amount is not number: ${typeof item?.amount})`);
                        continue;
                    }
                    const t = (item.type || '').toString().toLowerCase();
                    console.log(`    item: amount=${item.amount}, type="${item.type}", t="${t}"`);
                    if (t === 'one-time' || t === 'one_time' || t === 'one time') {
                        oneTimeTotal += item.amount;
                    } else if (t === 'monthly') {
                        monthlyTotal += item.amount;
                    }
                }

                console.log(`  monthlyTotal: ${monthlyTotal}`);
                console.log(`  oneTimeTotal: ${oneTimeTotal}`);
            }
        }

        process.exit(0);
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}

debugFeeStructure();
