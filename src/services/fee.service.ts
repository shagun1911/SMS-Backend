import { IFeeStructure, IStudentFee, IFeePayment, FeeStatus, PaymentMode } from '../types';
import FeeStructureRepository from '../repositories/feeStructure.repository';
import FeePaymentRepository from '../repositories/feePayment.repository';
import StudentFeeRepository from '../repositories/studentFee.repository';
import StudentRepository from '../repositories/student.repository';
import SessionRepository from '../repositories/session.repository';
import SchoolRepository from '../repositories/school.repository';
import TransportDestinationRepository from '../repositories/transportDestination.repository';
import ErrorResponse from '../utils/errorResponse';
import { Types } from 'mongoose';
import StudentFee from '../models/studentFee.model';
import Student from '../models/student.model';
import { getTenantFilter } from '../utils/tenant';
import { generateFeeStructurePDF } from './pdfFeeStructure.service';
import { generateReceiptPDF } from './pdfReceipt.service';
import path from 'path';
import fs from 'fs';
import {
    getSessionYearMonths,
    normalizeFeeExemptMonths,
    countChargeableSessionMonths,
    recurringAnnualMultiplier,
} from '../utils/feeExemptMonths';
import {
    computeReceiptAlignedStudentTotals,
    totalAnnualConcessionOnMonthly as sharedAnnualConcessionOnMonthly,
} from '../utils/feeCalculator';
import { cache } from '../utils/cache';

class FeeService {
    private async findFeeStructureForStudentClass(
        schoolId: string,
        sessionId: string,
        studentClassRaw: any
    ): Promise<any | null> {
        const raw = String(studentClassRaw || '').trim();
        if (!raw) return null;

        const candidates = new Set<string>();
        const push = (v: string) => {
            const x = String(v || '').trim();
            if (x) candidates.add(x);
        };

        push(raw);
        push(raw.replace(/^class\s+/i, ''));
        push(raw.split(' ')[0]);
        push(raw.split('-')[0]);
        push(raw.replace(/^class\s+/i, '').split('-')[0]);

        for (const cls of candidates) {
            const structure = await FeeStructureRepository.findByClass(schoolId, sessionId, cls);
            if (structure) return structure;
        }
        return null;
    }

    private invalidateFeeCachesForSchool(schoolId: string) {
        cache.delPrefix(`fees:stats:${schoolId}`);
        cache.delPrefix(`fees:defaulters:${schoolId}`);
        cache.delPrefix(`fees:pending-current:${schoolId}`);
        cache.delPrefix(`fees:monthly:${schoolId}:`);
        cache.delPrefix(`school:dashboard:${schoolId}`);
    }

    /**
     * Annual rupee concession on recurring (monthly) fees only: fixed amount plus a percentage of
     * (per-month total × session months). Capped at the annual recurring total. One-time fees are excluded.
     */
    private totalAnnualConcessionOnMonthly(student: any, annualRecurringTotal: number): number {
        return sharedAnnualConcessionOnMonthly(student, annualRecurringTotal);
    }

    private async resolveTransportMonthlyFee(student: any): Promise<{ amount: number; title?: string }> {
        if (!student?.usesTransport || !student?.transportDestinationId) return { amount: 0 };
        const destination = await TransportDestinationRepository.findById(
            String(student.transportDestinationId)
        );
        if (!destination) return { amount: 0 };
        return {
            amount: Number(destination.monthlyFee) || 0,
            title: destination.destinationName
                ? `Transport - ${destination.destinationName}`
                : 'Transport Fee',
        };
    }

    /** For receipt PDF row: total annual concession on monthly fees (flat + %), or undefined if none. */
    private concessionAnnualDisplayForReceipt(student: any, feeStructure: any | null, session: any): number | undefined {
        if (!feeStructure || !student || !session) return undefined;
        const rawItems: Array<{ amount: number; type?: string }> =
            feeStructure.components && feeStructure.components.length > 0
                ? feeStructure.components
                : (feeStructure.fees || []).map((f: any) => ({
                    amount: f.amount,
                    type: f.type,
                }));
        let monthlyTotal = 0;
        for (const item of rawItems) {
            if (!item || typeof item.amount !== 'number') continue;
            const t = (item.type || '').toString().toLowerCase();
            if (t === 'monthly') monthlyTotal += item.amount;
        }
        const sessionMonths = getSessionYearMonths(session);
        const annualRecurring = monthlyTotal * Math.max(1, sessionMonths.length);
        const total = this.totalAnnualConcessionOnMonthly(student, annualRecurring);
        return total > 0 ? total : undefined;
    }

    private async ensureStudentFeeLedgerForActiveSession(
        schoolId: string,
        student: any,
        opts?: { session?: any; feeStructure?: any | null; existingFeeKeys?: Set<string> }
    ): Promise<void> {
        const session = opts?.session ?? (await SessionRepository.findActive(schoolId));
        if (!session) return;
        if (!student?.class) return;

        let structure =
            opts?.feeStructure !== undefined ? opts.feeStructure : undefined;
        if (structure === undefined) {
            structure = await FeeStructureRepository.findByClass(schoolId, session._id.toString(), student.class);
            if (!structure && typeof student.class === 'string' && student.class.includes(' ')) {
                structure = await FeeStructureRepository.findByClass(
                    schoolId,
                    session._id.toString(),
                    student.class.split(' ')[0]
                );
            }
        }
        if (!structure) return;

        const rawItems: Array<{ title?: string; name?: string; amount: number; type?: string }> =
            (structure as any).components && (structure as any).components.length > 0
                ? (structure as any).components
                : ((structure as any).fees || []).map((f: any) => ({
                    title: f.title,
                    amount: f.amount,
                    type: f.type,
                }));

        const regularMonthlyItems = rawItems.filter((x: any) => (x.type || '').toString().toLowerCase() === 'monthly');
        const oneTimeItems = rawItems.filter((x: any) => {
            const t = (x.type || '').toString().toLowerCase();
            return t === 'one-time' || t === 'one_time' || t === 'one time';
        });

        const transport = await this.resolveTransportMonthlyFee(student);

        const regularMonthlyTotal = regularMonthlyItems.reduce(
            (sum: number, x: any) => sum + (Number(x.amount) || 0),
            0
        );
        const transportMonthlyAmount = Math.max(0, Number(transport.amount) || 0);
        const oneTimeTotal = oneTimeItems.reduce((sum: number, x: any) => sum + (Number(x.amount) || 0), 0);

        const months = getSessionYearMonths(session);
        const exemptCanon = normalizeFeeExemptMonths(
            (structure as any).feeExemptMonths,
            months.map((x) => x.monthName)
        );
        const sessionMonthCount = months.length;
        if (sessionMonthCount <= 0) return;

        // Apply student-level concession to monthly fee only (flat + % of annual recurring; one-time excluded).
        const annualRegular = regularMonthlyTotal * sessionMonthCount;
        const concession = this.totalAnnualConcessionOnMonthly(student, annualRegular);

        // Important: don't use Math.round per-month here, because it can slightly change the
        // effective annual concession (e.g., 6000 turning into 5997) due to rounding drift.
        // Instead, distribute the remaining rupees across months so the TOTAL matches exactly.
        // Example: if annualMonthlyAfter = 5997 and months = 12 -> 9 months get +1.
        const annualRegularAfter = concession > 0 && regularMonthlyTotal > 0
            ? Math.max(0, annualRegular - concession)
            : annualRegular;

        const annualRegularAfterInt = Math.round(annualRegularAfter);
        const baseRegularPerMonth = sessionMonthCount > 0
            ? Math.floor(annualRegularAfterInt / sessionMonthCount)
            : annualRegularAfterInt;
        const regularRemainder = sessionMonthCount > 0
            ? annualRegularAfterInt - (baseRegularPerMonth * sessionMonthCount)
            : 0;

        // Batch-fetch existing fee rows for this student+session to avoid N+1 DB calls
        let existingMonths: Set<string>;
        if (opts?.existingFeeKeys) {
            // Bulk mode: use pre-fetched set from caller (e.g. getDefaulters)
            existingMonths = new Set(
                months.map(m => m.monthName).filter(mn => opts.existingFeeKeys!.has(`${student._id}_${mn}`))
            );
            // Also check One-Time
            if (opts.existingFeeKeys.has(`${student._id}_One-Time`)) existingMonths.add('One-Time');
        } else {
            const existingFees = await StudentFee.find({
                schoolId: new Types.ObjectId(schoolId),
                studentId: student._id,
                sessionId: session._id,
            }).select('month').lean();
            existingMonths = new Set(existingFees.map((f: any) => String(f.month)));
        }

        // Monthly ledger entries:
        // - regular monthly components are charged in all session months
        // - exempt months waive transport fee only
        let regularIdx = 0;
        for (const m of months) {
            if (existingMonths.has(m.monthName)) continue;

            const adjustedRegularPerMonth =
                regularIdx < regularRemainder ? baseRegularPerMonth + 1 : baseRegularPerMonth;
            regularIdx++;
            const transportForMonth = exemptCanon.has(m.monthName) ? 0 : transportMonthlyAmount;
            const totalForMonth = adjustedRegularPerMonth + transportForMonth;
            const feeBreakdown = [
                ...regularMonthlyItems.map((f: any) => ({
                    title: f.title || f.name || 'Monthly Fee',
                    amount: Number(f.amount) || 0,
                    type: 'monthly',
                })),
                ...(transportMonthlyAmount > 0
                    ? [{
                        title: transport.title || 'Transport Fee',
                        amount: transportForMonth,
                        type: 'monthly',
                    }]
                    : []),
            ];

            await StudentFeeRepository.create({
                schoolId: new Types.ObjectId(schoolId) as any,
                studentId: student._id,
                sessionId: session._id,
                month: m.monthName,
                feeBreakdown,
                totalAmount: totalForMonth,
                paidAmount: 0,
                remainingAmount: totalForMonth,
                status: totalForMonth > 0 ? FeeStatus.PENDING : FeeStatus.EXEMPT,
                dueDate: new Date(m.year, m.month, 0, 23, 59, 59), // last day of month
                payments: [],
                discount: 0,
                lateFee: 0,
            } as any);
        }

        // One-time ledger entry (collected at admission)
        if (oneTimeTotal > 0) {
            const existing = existingMonths.has('One-Time');
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

    /**
     * Create or Update Fee Structure for a Class
     */
    async createFeeStructure(
        schoolId: string,
        data: Partial<IFeeStructure>
    ): Promise<IFeeStructure> {
        const session = await SessionRepository.findActive(schoolId);
        if (!session) throw new ErrorResponse('No active session found', 400);

        const existing = await FeeStructureRepository.findByClass(
            schoolId,
            session._id.toString(),
            data.class!
        );

        if (existing) {
            throw new ErrorResponse(`Fee structure already exists for Class ${data.class}`, 400);
        }

        const sessionMonths = getSessionYearMonths(session);
        const exemptCanon = normalizeFeeExemptMonths(
            (data as any).feeExemptMonths,
            sessionMonths.map((m) => m.monthName)
        );
        const payload: any = {
            ...data,
            schoolId: new Types.ObjectId(schoolId),
            sessionId: session._id,
        };
        if (data.classId) payload.classId = new Types.ObjectId(String(data.classId));
        if (data.components && data.components.length > 0) {
            payload.components = data.components;
        }
        payload.feeExemptMonths = exemptCanon.size > 0 ? Array.from(exemptCanon) : [];
        payload.monthlyMultiplier =
            exemptCanon.size > 0 ? Math.max(0, sessionMonths.length - exemptCanon.size) : undefined;
        return await FeeStructureRepository.create(payload);
    }

    async getStructureByClass(schoolId: string, classIdOrName: string): Promise<IFeeStructure | null> {
        const session = await SessionRepository.findActive(schoolId);
        if (!session) return null;
        return await FeeStructureRepository.findByClass(schoolId, session._id.toString(), classIdOrName);
    }

    async getStructuresBySession(schoolId: string): Promise<IFeeStructure[]> {
        const session = await SessionRepository.findActive(schoolId);
        if (!session) return [];
        return await FeeStructureRepository.findBySession(schoolId, session._id.toString());
    }

    async updateFeeStructure(schoolId: string, structureId: string, data: Partial<IFeeStructure>): Promise<IFeeStructure | null> {
        const session = await SessionRepository.findActive(schoolId);
        if (!session) throw new ErrorResponse('No active session found', 400);

        const existing = await FeeStructureRepository.findById(structureId);
        if (!existing || existing.schoolId.toString() !== schoolId) return null;

        const sessionMonths = getSessionYearMonths(session);
        const applyExemptToDoc = (doc: any, rawExempt: string[] | undefined) => {
            const exemptCanon =
                rawExempt !== undefined
                    ? normalizeFeeExemptMonths(rawExempt, sessionMonths.map((m) => m.monthName))
                    : normalizeFeeExemptMonths(doc.feeExemptMonths, sessionMonths.map((m) => m.monthName));
            doc.feeExemptMonths = exemptCanon.size > 0 ? Array.from(exemptCanon) : [];
            doc.monthlyMultiplier =
                exemptCanon.size > 0 ? Math.max(0, sessionMonths.length - exemptCanon.size) : undefined;
        };

        if (data.components && data.components.length > 0) {
            const doc = await FeeStructureRepository.findById(structureId);
            if (doc) {
                (doc as any).components = data.components;
                if ((data as any).feeExemptMonths !== undefined) {
                    applyExemptToDoc(doc as any, (data as any).feeExemptMonths);
                }
                await (doc as any).save();
                return doc;
            }
        }

        if ((data as any).feeExemptMonths !== undefined) {
            const doc = await FeeStructureRepository.findById(structureId);
            if (doc) {
                applyExemptToDoc(doc as any, (data as any).feeExemptMonths);
                await (doc as any).save();
                return doc;
            }
        }

        return await FeeStructureRepository.update(structureId, data);
    }

    async deleteFeeStructure(schoolId: string, structureId: string): Promise<boolean> {
        const existing = await FeeStructureRepository.findById(structureId);
        if (!existing || existing.schoolId.toString() !== schoolId) return false;
        await FeeStructureRepository.delete(structureId);
        return true;
    }

    async getStructurePrintPdf(
        schoolId: string,
        structureId: string,
        transportDestinationId?: string | null
    ): Promise<Buffer> {
        const structure = await FeeStructureRepository.findById(structureId);
        if (!structure || structure.schoolId.toString() !== schoolId) {
            throw new ErrorResponse('Fee structure not found', 404);
        }
        const school = await SchoolRepository.findById(schoolId);
        const session = await SessionRepository.findActive(schoolId);
        if (!school || !session) throw new ErrorResponse('School or session not found', 404);

        // Include transport monthly fee only when destination is explicitly selected.
        // If destination is not provided (or "none"), do not include any transport line.
        let selected: any = null;
        if (transportDestinationId && transportDestinationId !== 'none') {
            const byId = await TransportDestinationRepository.findById(transportDestinationId);
            if (byId && String((byId as any).schoolId) === schoolId) selected = byId;
        }
        return await generateFeeStructurePDF({
            school,
            session,
            structure,
            transportDestinationName: selected?.destinationName,
            transportMonthlyFee: selected?.monthlyFee,
        });
    }

    /**
     * Yearly fee payment: create FeePayment, update student paid/due, generate receipt PDF
     */
    async payFee(
        schoolId: string,
        payload: { studentId: string; amountPaid: number; paymentMode: string; paymentDate?: string; staffId?: string }
    ): Promise<{ payment: IFeePayment; pdfBuffer: Buffer }> {
        const student = await StudentRepository.findById(payload.studentId);
        if (!student || student.schoolId.toString() !== schoolId) {
            throw new ErrorResponse('Student not found', 404);
        }
        const session = await SessionRepository.findActive(schoolId);
        if (!session) throw new ErrorResponse('No active session', 400);

        const previousPaid = Number(student.paidAmount) || 0;
        let totalYearly = Number(student.totalYearlyFee) || 0;
        let grossTotalYearly = totalYearly; // Default to current total if no recalculation
        let cachedFeeStructure: any = null;
        if (student.class) {
            cachedFeeStructure = await FeeStructureRepository.findByClass(
                schoolId,
                session._id.toString(),
                student.class
            );
            if (cachedFeeStructure) {
                const rawItems: Array<{ amount: number; type?: string }> =
                    (cachedFeeStructure as any).components && (cachedFeeStructure as any).components.length > 0
                        ? (cachedFeeStructure as any).components
                        : ((cachedFeeStructure as any).fees || []).map((f: any) => ({
                            amount: f.amount,
                            type: f.type,
                        }));
                let monthlyTotal = 0;
                let oneTimeTotal = 0;
                for (const item of rawItems) {
                    if (!item || typeof item.amount !== 'number') continue;
                    const t = (item.type || '').toString().toLowerCase();
                    if (t === 'one-time' || t === 'one_time' || t === 'one time') oneTimeTotal += item.amount;
                    else if (t === 'monthly') monthlyTotal += item.amount;
                }
                const transport = await this.resolveTransportMonthlyFee(student);
                const transportMonthly = Math.max(0, Number(transport.amount) || 0);

                const sessionMonthsForAnnual = getSessionYearMonths(session);
                const exemptForAnnual = normalizeFeeExemptMonths(
                    (cachedFeeStructure as any).feeExemptMonths,
                    sessionMonthsForAnnual.map((m) => m.monthName)
                );
                const sessionMonthCount = Math.max(1, sessionMonthsForAnnual.length);
                const transportChargeableCount = Math.max(
                    0,
                    countChargeableSessionMonths(sessionMonthsForAnnual, exemptForAnnual)
                );
                const annualRegular = monthlyTotal * sessionMonthCount;
                const annualTransport = transportMonthly * transportChargeableCount;
                const concession = this.totalAnnualConcessionOnMonthly(student, annualRegular);
                const adjustedAnnualRecurring = Math.max(0, annualRegular - concession) + annualTransport;
                grossTotalYearly = annualRegular + annualTransport + oneTimeTotal; // Gross total before concession
                totalYearly = adjustedAnnualRecurring + oneTimeTotal; // Net total after concession
                const recomputedDue = Math.max(0, totalYearly - previousPaid);

                await StudentRepository.update(payload.studentId, {
                    totalYearlyFee: totalYearly,
                    dueAmount: recomputedDue,
                } as any);
            }
        }
        const dueBefore = Math.max(0, totalYearly - previousPaid);
        if (payload.amountPaid <= 0) throw new ErrorResponse('Invalid payment amount', 400);
        if (payload.amountPaid > dueBefore) throw new ErrorResponse('Payment exceeds remaining due', 400);
        const yearPrefix = session.sessionYear ? session.sessionYear.split('-')[0] : String(new Date().getFullYear());
        const receiptNumber = await FeePaymentRepository.getNextReceiptNumber(schoolId, yearPrefix);

        const paymentDate = payload.paymentDate ? new Date(payload.paymentDate) : new Date();
        const remainingDue = dueBefore - payload.amountPaid;
        const newPaidAmount = previousPaid + payload.amountPaid;

        const payment = await FeePaymentRepository.create({
            schoolId: new Types.ObjectId(schoolId) as any,
            studentId: new Types.ObjectId(payload.studentId) as any,
            receiptNumber,
            amountPaid: payload.amountPaid,
            paymentMode: payload.paymentMode,
            paymentDate,
            previousDue: dueBefore,
            remainingDue,
        } as any);

        await StudentRepository.update(payload.studentId, {
            paidAmount: newPaidAmount,
            dueAmount: remainingDue,
        } as any);

        // Allocate the payment into per-month StudentFee ledger records sequentially.
        // This ensures Expected/Pending on the fee management screen reflect reality.
        try {
            await this.ensureStudentFeeLedgerForActiveSession(schoolId, student, {
                session,
            });
            const months = getSessionYearMonths(session);
            let remaining = payload.amountPaid;
            for (const m of months) {
                if (remaining <= 0) break;
                const fee = await StudentFeeRepository.findByStudentMonth(
                    schoolId,
                    payload.studentId,
                    session._id.toString(),
                    m.monthName
                );
                if (!fee || fee.status === FeeStatus.PAID || fee.status === FeeStatus.EXEMPT) continue;
                const available = fee.remainingAmount ?? 0;
                if (available <= 0) continue;
                const amt = Math.min(remaining, available);
                if (payload.staffId) {
                    await this.recordPayment(schoolId, fee._id.toString(), {
                        amount: amt,
                        mode: payload.paymentMode as PaymentMode,
                        staffId: payload.staffId,
                        receiptNumber: payment.receiptNumber,
                        paymentDate,
                        remarks: 'Monthly fee payment',
                    });
                } else {
                    // No staffId available — update ledger directly.
                    (fee as any).paidAmount = ((fee as any).paidAmount || 0) + amt;
                    (fee as any).remainingAmount = Math.max(0, ((fee as any).remainingAmount || 0) - amt);
                    if ((fee as any).remainingAmount <= 0) (fee as any).status = FeeStatus.PAID;
                    await (fee as any).save();
                }
                remaining -= amt;
            }
        } catch (_) {
            // Ledger allocation failure must not block the fee payment itself.
        }

        const school = await SchoolRepository.findById(schoolId);
        if (!school) throw new ErrorResponse('School not found', 404);

        // Load fee components for itemized receipt
        let feeComponents: Array<{ name: string; amount: number }> | undefined;
        let feeStructureForReceipt: any = null;
        if (student.class) {
            // Reuse the structure already loaded above instead of fetching again
            feeStructureForReceipt = cachedFeeStructure;
            if (feeStructureForReceipt) {
                const sm = getSessionYearMonths(session);
                const ex = normalizeFeeExemptMonths(
                    (feeStructureForReceipt as any).feeExemptMonths,
                    sm.map((m) => m.monthName)
                );
                const regularMult = Math.max(1, sm.length);
                const transportMult = recurringAnnualMultiplier(feeStructureForReceipt as any, sm.length, ex);
                const items =
                    feeStructureForReceipt.components && feeStructureForReceipt.components.length > 0
                        ? feeStructureForReceipt.components
                        : (feeStructureForReceipt.fees || []).map((f: any) => ({
                            name: f.title || f.name,
                            amount: f.amount,
                            type: f.type,
                        }));
                feeComponents = items.map((c: any) => ({
                    name: c.name,
                    amount: c.type === 'one-time' ? c.amount : c.amount * regularMult,
                }));
                const transport = await this.resolveTransportMonthlyFee(student);
                if (transport.amount > 0) {
                    if (!feeComponents) feeComponents = [];
                    feeComponents.push({
                        name: transport.title || 'Transport Fee',
                        amount: transport.amount * transportMult,
                    });
                }
            }
        }
        const concessionAnnualDisplay = this.concessionAnnualDisplayForReceipt(
            student,
            feeStructureForReceipt,
            session
        );

        // Resolve which academic month this receipt was applied to by checking
        // the StudentFee ledger entries that contain this receiptNumber.
        // For a receipt spanning multiple months, we take the latest month (max dueDate).
        let feeMonth: string | undefined = undefined;
        try {
            const feeDoc = await StudentFee.findOne({
                schoolId: new Types.ObjectId(schoolId),
                studentId: payment.studentId,
                sessionId: session._id,
                'payments.receiptNumber': payment.receiptNumber,
            }).sort({ dueDate: -1 }).lean();
            feeMonth = feeDoc?.month ? String(feeDoc.month) : undefined;
        } catch (_) {
            // If anything fails, we fall back to the generic session month label.
        }

        const pdfBuffer = await generateReceiptPDF({
            school,
            payment,
            student,
            totalAnnualFee: grossTotalYearly || totalYearly,
            previousPaid,
            thisPayment: payload.amountPaid,
            remainingDue,
            sessionYear: session.sessionYear,
            feeComponents,
            feeMonth,
            concessionAnnualDisplay,
        });

        const receiptsDir = path.join(process.cwd(), 'receipts');
        if (!fs.existsSync(receiptsDir)) fs.mkdirSync(receiptsDir, { recursive: true });
        const pdfPath = path.join(receiptsDir, `${payment.receiptNumber.replace(/\//g, '-')}.pdf`);
        fs.writeFileSync(pdfPath, pdfBuffer);
        await FeePaymentRepository.update(payment._id.toString(), { pdfPath } as any);

        this.invalidateFeeCachesForSchool(schoolId);
        return { payment, pdfBuffer };
    }

    async getStudentFeePayments(
        schoolId: string,
        studentId: string,
        year?: number,
        month?: number
    ): Promise<IFeePayment[]> {
        const all = await FeePaymentRepository.findByStudent(schoolId, studentId);
        if (!year || !month) return all;
        return all.filter((p: any) => {
            const d = new Date(p.paymentDate);
            return d.getFullYear() === year && d.getMonth() + 1 === month;
        });
    }

    async getStudentFeeSummary(
        schoolId: string,
        studentId: string
    ): Promise<{
        student: any;
        payments: IFeePayment[];
        totalFeeBeforeConcession?: number;
        concessionAmount?: number;
        totalFeeAfterConcession?: number;
        paidAmount?: number;
        dueAmount?: number;
        monthlyFee?: number;
        oneTimeFee?: number;
        feeExemptMonths?: string[];
        sessionMonthlyFees?: Array<{
            month: string;
            totalAmount: number;
            paidAmount: number;
            remainingAmount: number;
            status: string;
        }>;
    } | null> {
        const student = await StudentRepository.findById(studentId);
        if (!student || student.schoolId.toString() !== schoolId) return null;
        const totalFromStudent = (student as any).totalYearlyFee ?? 0;
        const studentClass = (student as any).class;
        let monthlyFee: number | undefined;
        let oneTimeFee: number | undefined;

        // Always look up the fee structure so we can return accurate monthlyFee / oneTimeFee.
        // (Previously this was guarded by totalFromStudent === 0, which meant students who
        //  already had totalYearlyFee set never got these fields populated.)
        if (studentClass) {
            const session = await SessionRepository.findActive(schoolId);
            if (session) {
                let structure = await this.findFeeStructureForStudentClass(
                    schoolId,
                    session._id.toString(),
                    studentClass
                );
                if (structure) {
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

                    const transport = await this.resolveTransportMonthlyFee(student);
                    if (transport.amount > 0) monthlyTotal += transport.amount;

                    const sessionMonths = getSessionYearMonths(session);
                    const canonicalTotals = computeReceiptAlignedStudentTotals({
                        student,
                        structure,
                        session,
                        transportMonthlyFee: transport.amount,
                    });

                    monthlyFee =
                        canonicalTotals.effectiveMonthlyFee > 0
                            ? canonicalTotals.effectiveMonthlyFee
                            : undefined;
                    oneTimeFee = oneTimeTotal > 0 ? oneTimeTotal : undefined;

                    await this.ensureStudentFeeLedgerForActiveSession(schoolId, student, {
                        session,
                        feeStructure: structure,
                    });
                    const feeRows = await StudentFee.find({
                        schoolId: new Types.ObjectId(schoolId),
                        studentId: student._id,
                        sessionId: session._id,
                    }).lean();
                    const byMonth = new Map((feeRows as any[]).map((f) => [String(f.month), f]));
                    const sessionMonthlyFees = sessionMonths.map((m) => {
                        const f = byMonth.get(m.monthName) as any;
                        return {
                            month: m.monthName,
                            totalAmount: Number(f?.totalAmount) || 0,
                            paidAmount: Number(f?.paidAmount) || 0,
                            remainingAmount: Number(f?.remainingAmount) || 0,
                            status: String(f?.status || 'pending'),
                        };
                    });
                    const feeExemptMonthsOut = canonicalTotals.feeExemptMonths;
                    const totalFeeBeforeConcession = canonicalTotals.grossAnnual;
                    // Keep concession exactly aligned with receipt PDF row logic.
                    const concessionAmount =
                        this.concessionAnnualDisplayForReceipt(student, structure as any, session) ??
                        canonicalTotals.concessionAnnual;
                    const totalFeeAfterConcession = Math.max(
                        0,
                        totalFeeBeforeConcession - concessionAmount
                    );

                    // Paid shown to users should reflect real receipts (same source used by receipt list).
                    const payments = await FeePaymentRepository.findByStudent(schoolId, studentId);
                    const canonicalPaid = payments.reduce(
                        (sum: number, p: any) => sum + (Number(p?.amountPaid) || 0),
                        0
                    );
                    const canonicalDue = Math.max(0, totalFeeAfterConcession - canonicalPaid);

                    // Keep the student aggregate amounts aligned with ledger values.
                    // This ensures Student profile, fee pages, and receipt math stay consistent.
                    const currentStudentTotal = Number((student as any).totalYearlyFee) || 0;
                    const currentStudentPaid = Number((student as any).paidAmount) || 0;
                    const currentStudentDue = Number((student as any).dueAmount) || 0;

                    const hasAggregateDrift =
                        Math.abs(currentStudentTotal - totalFeeAfterConcession) > 0.0001 ||
                        Math.abs(currentStudentPaid - canonicalPaid) > 0.0001 ||
                        Math.abs(currentStudentDue - canonicalDue) > 0.0001;

                    // Back-fill totalYearlyFee on student if it was missing.
                    if (totalFromStudent === 0 || hasAggregateDrift) {
                        const targetTotal = totalFromStudent === 0 && totalFeeAfterConcession <= 0
                            ? (structure.totalAmount ??
                                structure.totalAnnualFee ??
                                monthlyTotal *
                                canonicalTotals.multiplier +
                                oneTimeTotal)
                            : totalFeeAfterConcession;
                        const targetPaid = totalFromStudent === 0 && totalFeeAfterConcession <= 0
                            ? Number((student as any).paidAmount) || 0
                            : canonicalPaid;
                        const targetDue = Math.max(0, targetTotal - targetPaid);

                        await StudentRepository.update(studentId, {
                            totalYearlyFee: targetTotal,
                            paidAmount: targetPaid,
                            dueAmount: targetDue,
                        } as any);
                        const updated = await StudentRepository.findById(studentId);
                        if (updated) {
                            return {
                                student: updated,
                                payments,
                                totalFeeBeforeConcession,
                                concessionAmount,
                                totalFeeAfterConcession,
                                paidAmount: targetPaid,
                                dueAmount: targetDue,
                                monthlyFee,
                                oneTimeFee,
                                feeExemptMonths: feeExemptMonthsOut,
                                sessionMonthlyFees,
                            };
                        }
                    }

                    return {
                        student: {
                            ...(student as any),
                            totalYearlyFee: totalFeeAfterConcession,
                            paidAmount: canonicalPaid,
                            dueAmount: canonicalDue,
                        } as any,
                        payments,
                        totalFeeBeforeConcession,
                        concessionAmount,
                        totalFeeAfterConcession,
                        paidAmount: canonicalPaid,
                        dueAmount: canonicalDue,
                        monthlyFee,
                        oneTimeFee,
                        feeExemptMonths: feeExemptMonthsOut,
                        sessionMonthlyFees,
                    };
                }
            }
        }
        const payments = await FeePaymentRepository.findByStudent(schoolId, studentId);
        return {
            student,
            payments,
            totalFeeBeforeConcession: Number((student as any).totalYearlyFee) || 0,
            concessionAmount: 0,
            totalFeeAfterConcession: Number((student as any).totalYearlyFee) || 0,
            paidAmount: Number((student as any).paidAmount) || 0,
            dueAmount: Number((student as any).dueAmount) || 0,
            monthlyFee,
            oneTimeFee,
        };
    }

    async getReceiptPdf(schoolId: string, receiptId: string): Promise<Buffer> {
        const payment = await FeePaymentRepository.findById(receiptId);
        if (!payment || payment.schoolId.toString() !== schoolId) {
            throw new ErrorResponse('Receipt not found', 404);
        }
        const student = await StudentRepository.findById(payment.studentId.toString());
        const school = await SchoolRepository.findById(schoolId);
        if (!student || !school) throw new ErrorResponse('Student or school not found', 404);
        const totalYearly = student.totalYearlyFee ?? 0;
        const previousPaid = (student.paidAmount ?? 0) - payment.amountPaid;

        const session = await SessionRepository.findActive(schoolId);
        let feeComponents: Array<{ name: string; amount: number }> | undefined;
        let feeStructureForReceipt: any = null;
        if (student.class && session) {
            feeStructureForReceipt = await FeeStructureRepository.findByClass(
                schoolId, session._id.toString(), student.class
            );
            if (feeStructureForReceipt && session) {
                const sm = getSessionYearMonths(session);
                const ex = normalizeFeeExemptMonths(
                    (feeStructureForReceipt as any).feeExemptMonths,
                    sm.map((m) => m.monthName)
                );
                const regularMult = Math.max(1, sm.length);
                const transportMult = recurringAnnualMultiplier(feeStructureForReceipt as any, sm.length, ex);
                const rawItems = ((feeStructureForReceipt.components ?? []).length > 0)
                    ? (feeStructureForReceipt.components ?? [])
                    : (feeStructureForReceipt.fees || []).map((f: any) => ({
                        name: f.title || f.name,
                        amount: f.amount,
                        type: f.type,
                    }));
                feeComponents = rawItems.map((c: any) => ({
                    name: c.name,
                    amount: c.type === 'one-time' ? c.amount : c.amount * regularMult,
                }));
                const transport = await this.resolveTransportMonthlyFee(student);
                if (transport.amount > 0) {
                    if (!feeComponents) feeComponents = [];
                    feeComponents.push({
                        name: transport.title || 'Transport Fee',
                        amount: transport.amount * transportMult,
                    });
                }
            }
        }
        const concessionAnnualDisplay = session
            ? this.concessionAnnualDisplayForReceipt(student, feeStructureForReceipt, session)
            : undefined;

        // Determine academic month for this receipt by checking which StudentFee
        // ledger rows contain this receiptNumber. Pick the latest dueDate month.
        let feeMonth: string | undefined = undefined;
        try {
            if (session) {
                const feeDoc = await StudentFee.findOne({
                    schoolId: new Types.ObjectId(schoolId),
                    studentId: payment.studentId,
                    sessionId: session._id,
                    'payments.receiptNumber': payment.receiptNumber,
                }).sort({ dueDate: -1 }).lean();
                feeMonth = feeDoc?.month ? String(feeDoc.month) : undefined;
            }
        } catch (_) {
            // fallback to session label
        }

        return await generateReceiptPDF({
            school,
            payment,
            student,
            totalAnnualFee: totalYearly,
            previousPaid,
            thisPayment: payment.amountPaid,
            remainingDue: payment.remainingDue,
            sessionYear: session?.sessionYear,
            feeComponents,
            feeMonth,
            concessionAnnualDisplay,
        });
    }

    async listFeePayments(
        schoolId: string,
        limit = 200,
        studentId?: string
    ): Promise<Array<IFeePayment & { paymentDetail?: string; appliedMonths?: string[] }>> {
        const payments = studentId
            ? await FeePaymentRepository.findByStudent(schoolId, studentId)
            : await FeePaymentRepository.findPaymentsBySchool(schoolId, limit);

        // Hide payments for students that have been deleted (studentId failed to populate),
        // so receipts list does not show \"Unknown\" rows.
        const validPayments = payments.filter((p: any) => p.studentId);

        const receiptNumbers = [...new Set(
            validPayments
                .map((p: any) => String((p as any)?.receiptNumber || '').trim())
                .filter(Boolean)
        )];

        const receiptToMonths = new Map<string, string[]>();
        if (receiptNumbers.length) {
            const feeDocs = await StudentFee.find({
                schoolId: new Types.ObjectId(schoolId),
                'payments.receiptNumber': { $in: receiptNumbers },
            })
                .select('month payments.receiptNumber')
                .lean();

            for (const doc of feeDocs as any[]) {
                const feeMonth = String(doc?.month || '').trim();
                if (!feeMonth) continue;
                for (const row of (doc?.payments || [])) {
                    const rn = String(row?.receiptNumber || '').trim();
                    if (!rn) continue;
                    const arr = receiptToMonths.get(rn) || [];
                    if (!arr.includes(feeMonth)) arr.push(feeMonth);
                    receiptToMonths.set(rn, arr);
                }
            }
        }

        return validPayments.map((p: any) => {
            const obj = p && typeof p.toObject === 'function' ? p.toObject() : p;
            const rn = String(obj?.receiptNumber || '').trim();
            const appliedMonths = [...new Set(rn ? (receiptToMonths.get(rn) || []) : [])];
            let paymentDetail = 'Fee paid';
            if (appliedMonths.length === 1) {
                paymentDetail =
                    appliedMonths[0] === 'One-Time'
                        ? 'One-time fee paid'
                        : `${appliedMonths[0]} fee paid`;
            } else if (appliedMonths.length > 1) {
                paymentDetail = `Fees paid (${appliedMonths.join(', ')})`;
            }
            return { ...obj, appliedMonths, paymentDetail };
        });
    }

    async listFeePaymentsPaged(
        schoolId: string,
        page: number,
        limit: number,
        studentId?: string
    ): Promise<{ items: Array<IFeePayment & { paymentDetail?: string; appliedMonths?: string[] }>; total: number }> {
        const safePage = Math.max(1, Math.floor(page || 1));
        const safeLimit = Math.max(1, Math.min(500, Math.floor(limit || 50)));
        const [total, payments] = await Promise.all([
            FeePaymentRepository.countBySchool(schoolId, studentId),
            FeePaymentRepository.findPaymentsBySchoolPaged(schoolId, safePage, safeLimit, studentId),
        ]);

        // Hide payments for deleted students, preserve list behavior.
        const validPayments = payments.filter((p: any) => p.studentId);
        const receiptNumbers = [...new Set(
            validPayments
                .map((p: any) => String((p as any)?.receiptNumber || '').trim())
                .filter(Boolean)
        )];

        const receiptToMonths = new Map<string, string[]>();
        if (receiptNumbers.length) {
            const feeDocs = await StudentFee.find({
                schoolId: new Types.ObjectId(schoolId),
                'payments.receiptNumber': { $in: receiptNumbers },
            })
                .select('month payments.receiptNumber')
                .lean();
            for (const doc of feeDocs as any[]) {
                const feeMonth = String(doc?.month || '').trim();
                if (!feeMonth) continue;
                for (const row of (doc?.payments || [])) {
                    const rn = String(row?.receiptNumber || '').trim();
                    if (!rn) continue;
                    const arr = receiptToMonths.get(rn) || [];
                    if (!arr.includes(feeMonth)) arr.push(feeMonth);
                    receiptToMonths.set(rn, arr);
                }
            }
        }

        const items = validPayments.map((p: any) => {
            const rn = String((p as any)?.receiptNumber || '').trim();
            const appliedMonths = [...new Set(rn ? (receiptToMonths.get(rn) || []) : [])];
            let paymentDetail = 'Fee paid';
            if (appliedMonths.length === 1) {
                paymentDetail = appliedMonths[0] === 'One-Time' ? 'One-time fee paid' : `${appliedMonths[0]} fee paid`;
            } else if (appliedMonths.length > 1) {
                paymentDetail = `Fees paid (${appliedMonths.join(', ')})`;
            }
            return { ...(p as any), appliedMonths, paymentDetail };
        });

        return { items, total };
    }

    async getDefaulters(schoolId: string): Promise<any[]> {
        const schoolObjId = new Types.ObjectId(schoolId);
        const today = new Date();
        const currentMonthStart = new Date(today.getFullYear(), today.getMonth(), 1, 0, 0, 0, 0);

        const activeSession = await SessionRepository.findActive(schoolId);
        if (!activeSession) return [];

        // Ensure active-session monthly ledger exists so expected-till-last-month
        // can be computed consistently for all active students.
        const activeStudents = await Student.find({
            schoolId: schoolObjId,
            isActive: true,
        })
            .select('_id class admissionDate totalYearlyFee concessionAmount concessionPercent firstName lastName fatherName section admissionNumber paidAmount dueAmount')
            .sort({ class: 1, section: 1 })
            .lean();

        // Prefetch fee structures once per distinct class (same outcome as per-student lookups, fewer DB round-trips).
        const uniqueClasses = [
            ...new Set(
                (activeStudents as any[])
                    .map((s: any) => (s?.class || '').toString().trim())
                    .filter(Boolean)
            ),
        ];
        const feeStructureByClass = new Map<string, any | null>();
        for (const cls of uniqueClasses) {
            let st = await FeeStructureRepository.findByClass(schoolId, activeSession._id.toString(), cls);
            if (!st && cls.includes(' ')) {
                st = await FeeStructureRepository.findByClass(
                    schoolId,
                    activeSession._id.toString(),
                    cls.split(' ')[0]
                );
            }
            feeStructureByClass.set(cls, st ?? null);
        }

        const resolveFeeStructureForStudent = (s: any) => {
            const cls = (s?.class || '').toString().trim();
            if (!cls) return undefined;
            if (feeStructureByClass.has(cls)) return feeStructureByClass.get(cls);
            if (cls.includes(' ') && feeStructureByClass.has(cls.split(' ')[0])) {
                return feeStructureByClass.get(cls.split(' ')[0]);
            }
            return undefined;
        };

        // Bulk-prefetch all existing fee rows for the entire school+session
        // so ensureStudentFeeLedgerForActiveSession can skip per-student DB lookups.
        const allExistingFees = await StudentFee.find({
            schoolId: schoolObjId,
            sessionId: activeSession._id,
        }).select('studentId month').lean();
        const existingFeeKeys = new Set(
            allExistingFees.map((f: any) => `${f.studentId}_${f.month}`)
        );

        const LEDGER_ENSURE_CONCURRENCY = 20;
        const withClass = (activeStudents as any[]).filter((s: any) => s?.class);
        for (let i = 0; i < withClass.length; i += LEDGER_ENSURE_CONCURRENCY) {
            const batch = withClass.slice(i, i + LEDGER_ENSURE_CONCURRENCY);
            await Promise.all(
                batch.map((s: any) =>
                    this.ensureStudentFeeLedgerForActiveSession(schoolId, s, {
                        session: activeSession,
                        feeStructure: resolveFeeStructureForStudent(s),
                        existingFeeKeys,
                    }).catch(() => undefined)
                )
            );
        }

        // Previous-month arrears are based on monthly fee rows only
        // (exclude One-Time from defaulter calculation).
        const previousRows = await StudentFee.find({
            schoolId: schoolObjId,
            sessionId: activeSession._id,
            dueDate: { $lt: currentMonthStart },
            month: { $ne: 'One-Time' },
        })
            .select('studentId month dueDate totalAmount remainingAmount')
            .lean();

        const students = activeStudents as any[];

        const studentMap = new Map<string, any>(students.map((s: any) => [String(s._id), s]));
        const byStudent = new Map<string, {
            expectedTillPrev: number;
            paidTillPrev: number;
            previousMonthDue: number;
            unpaidMonths: string[];
        }>();

        for (const row of previousRows as any[]) {
            const sid = String(row.studentId);
            const student = studentMap.get(sid);
            if (!student) continue;

            const due = Math.max(0, Number(row.remainingAmount) || 0);
            const total = Math.max(0, Number(row.totalAmount) || 0);

            const existing = byStudent.get(sid) || {
                expectedTillPrev: 0,
                paidTillPrev: 0,
                previousMonthDue: 0,
                unpaidMonths: [],
            };
            existing.expectedTillPrev += total;
            existing.paidTillPrev += Math.max(0, total - due);
            existing.previousMonthDue += due;

            const monthLabel = String(row.month || '').trim();
            if (due > 0 && monthLabel && !existing.unpaidMonths.includes(monthLabel)) {
                existing.unpaidMonths.push(monthLabel);
            }

            byStudent.set(sid, existing);
        }

        return students
            .map((s: any) => {
                const agg = byStudent.get(String(s._id));
                if (!agg || agg.expectedTillPrev <= 0) return null;
                const paidTillPrev = Math.max(0, agg.paidTillPrev);
                const previousMonthDue = Math.max(0, agg.expectedTillPrev - paidTillPrev);
                if (previousMonthDue <= 0) return null;
                return {
                    ...s,
                    expectedTillPrev: Math.round(agg.expectedTillPrev),
                    paidTillPrev: Math.round(paidTillPrev),
                    previousMonthDue: Math.round(previousMonthDue),
                    unpaidMonths: agg.unpaidMonths,
                };
            })
            .filter(Boolean);
    }

    /**
     * Pending students for the current month.
     * Pending current month = paid up to previous months, but not fully paid up to current month.
     */
    async getPendingCurrentMonthStudents(schoolId: string): Promise<any[]> {
        const today = new Date();

        const session = await SessionRepository.findActive(schoolId);
        if (!session) return [];

        // Map today's date into the active session's month list.
        const sessionMonths = getSessionYearMonths(session);
        const todayYear = today.getFullYear();
        const todayMonth = today.getMonth() + 1; // 1-based
        const currentSessionMonth = sessionMonths.find((m) => m.year === todayYear && m.month === todayMonth);
        if (!currentSessionMonth) return [];

        const currentMonthName = currentSessionMonth.monthName;
        const sessionId = session._id.toString();

        // IMPORTANT:
        // Always use the ledger's `totalAmount/paidAmount/remainingAmount` for the current month.
        // This guarantees "Pending (Current month)" is perfectly synced with your Fee Structure
        // and any student-level concession adjustments already baked into the ledger.
        const feeRecords = await StudentFeeRepository.findByMonth(schoolId, sessionId, currentMonthName);

        const pending = feeRecords
            .filter(
                (f: any) =>
                    (f.status || '').toString() !== FeeStatus.EXEMPT &&
                    (f.status || '').toString() !== FeeStatus.PAID &&
                    (f.remainingAmount ?? 0) > 0
            )
            .sort((a: any, b: any) => {
                // Keep stable ordering; class/section sorting will be handled after student fetch.
                return String(a.studentId).localeCompare(String(b.studentId));
            });

        const studentIds = Array.from(new Set(pending.map((f: any) => String(f.studentId))));
        if (studentIds.length === 0) return [];

        const students = await Student.find({
            schoolId: new Types.ObjectId(schoolId),
            isActive: true,
            _id: { $in: studentIds }
        }).lean();

        const studentMap = new Map<string, any>(students.map((s: any) => [String(s._id), s]));

        return pending
            .map((f: any) => {
                const s = studentMap.get(String(f.studentId));
                if (!s) return null;

                // Don't mark fees pending for months that happened before the student's admission.
                const admissionDate = s.admissionDate ? new Date(s.admissionDate) : null;
                const feeDueDate = f.dueDate ? new Date(f.dueDate) : null;
                if (admissionDate && feeDueDate && feeDueDate < admissionDate) return null;

                return {
                    ...s,
                    currentMonthTotal: f.totalAmount ?? 0,
                    currentMonthPaid: f.paidAmount ?? 0,
                    currentMonthDue: f.remainingAmount ?? 0,
                };
            })
            .filter(Boolean)
            .sort((a: any, b: any) => {
                const ca = (a.class || '').toString();
                const cb = (b.class || '').toString();
                // Sort class/section roughly in numeric order when possible.
                const classCmp = ca.localeCompare(cb, undefined, { numeric: true, sensitivity: 'base' });
                if (classCmp !== 0) return classCmp;
                return (a.section || '').toString().localeCompare((b.section || '').toString(), undefined, { sensitivity: 'base' });
            });
    }

    /**
     * Process initial deposit on student registration: set totalYearlyFee, create first receipt, update student
     */
    async processInitialDeposit(
        schoolId: string,
        student: any,
        data: {
            initialDepositAmount: number;
            paymentMode?: string;
            depositDate?: Date;
            transactionId?: string;
            staffId: string;
            concessionAmount?: number;
            concessionPercent?: number;
        }
    ): Promise<IFeePayment | null> {
        const session = await SessionRepository.findActive(schoolId);
        if (!session) return null;

        const flatConcession = Math.max(0, Math.round(Number(data.concessionAmount) || 0));
        const pctConcession = Math.min(100, Math.max(0, Number(data.concessionPercent) || 0));
        (student as any).concessionAmount = flatConcession;
        (student as any).concessionPercent = pctConcession;
        await StudentRepository.update(student._id.toString(), {
            concessionAmount: flatConcession,
            concessionPercent: pctConcession,
        } as any);

        // Ensure per-month ledger exists for this student in this session.
        // This allows advance payments (e.g. paid in March for April) to reduce April's pending/expected.
        await this.ensureStudentFeeLedgerForActiveSession(schoolId, student);

        let totalYearly = student.totalYearlyFee ?? 0;
        let firstMonthFee = 0;
        let oneTimeTotalFromStructure = 0;
        let structureForReceipt: any = null;

        // Derive yearly + first-month fee from fee structure when possible
        if (student.class) {
            const structure = await FeeStructureRepository.findByClass(
                schoolId,
                session._id.toString(),
                student.class
            );
            structureForReceipt = structure;
            if (structure) {
                // Prefer new components model (with type 'monthly' | 'one-time')
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

                const transport = await this.resolveTransportMonthlyFee(student);
                const transportMonthly = Math.max(0, Number(transport.amount) || 0);

                const sessionMonthsInit = getSessionYearMonths(session);
                const exemptInit = normalizeFeeExemptMonths(
                    (structure as any).feeExemptMonths,
                    sessionMonthsInit.map((m) => m.monthName)
                );
                const sessionMonthCount = Math.max(1, sessionMonthsInit.length);
                const transportChargeableCount = Math.max(
                    0,
                    countChargeableSessionMonths(sessionMonthsInit, exemptInit)
                );

                // Apply concession on recurring fees only (flat + % of annual monthly total).
                const annualRegular = monthlyTotal * sessionMonthCount;
                const annualTransport = transportMonthly * transportChargeableCount;
                const concessionTotal = this.totalAnnualConcessionOnMonthly(student, annualRegular);
                const adjustedMonthlyAnnual = Math.max(0, annualRegular - concessionTotal) + annualTransport;

                // Annual = adjusted monthly total + all one-time components
                const computedAnnual = adjustedMonthlyAnnual + oneTimeTotal;
                if (!totalYearly || totalYearly <= 0) {
                    totalYearly = computedAnnual;
                } else if (concessionTotal > 0) {
                    // Recalculate if concession was given, overriding any old value
                    totalYearly = computedAnnual;
                }

                // Initial deposit covers ONLY one-time components
                if (oneTimeTotal > 0) {
                    firstMonthFee = oneTimeTotal;
                }

                oneTimeTotalFromStructure = oneTimeTotal;
            }
        }

        // If still no annual total (no structure), fall back to provided amount
        if (totalYearly === 0 && data.initialDepositAmount > 0) {
            totalYearly = data.initialDepositAmount;
        }

        // Decide how much to actually charge for the initial deposit.
        // Business rule change:
        //   Initial deposit = sum of ALL one-time components for the session
        //   (admission fee, exam fee, electricity one-time, etc.).
        let initialAmount = data.initialDepositAmount;
        if (!initialAmount || initialAmount <= 0) {
            // Default to one-time total from structure; if not available, fall back to annual.
            initialAmount = firstMonthFee || totalYearly;
        }
        if (!initialAmount || initialAmount <= 0) return null;

        const yearPrefix = session.sessionYear ? session.sessionYear.split('-')[0] : String(new Date().getFullYear());
        const receiptNumber = await FeePaymentRepository.getNextReceiptNumber(schoolId, yearPrefix);
        const paymentDate = data.depositDate ? new Date(data.depositDate) : new Date();
        const remainingDue = totalYearly - initialAmount;
        const payment = await FeePaymentRepository.create({
            schoolId: new Types.ObjectId(schoolId) as any,
            studentId: student._id,
            receiptNumber,
            amountPaid: initialAmount,
            paymentMode: data.paymentMode || 'cash',
            paymentDate,
            previousDue: 0,
            remainingDue,
            transactionId: data.transactionId,
        } as any);
        await StudentRepository.update(student._id.toString(), {
            totalYearlyFee: totalYearly,
            paidAmount: initialAmount,
            dueAmount: remainingDue,
            initialDepositAmount: initialAmount,
            depositPaymentMode: data.paymentMode,
            depositDate: paymentDate,
            depositTransactionId: data.transactionId,
            concessionAmount: flatConcession,
            concessionPercent: pctConcession,
        } as any);

        // Allocate the deposit into the ledger:
        // 1) Pay One-Time fees first (if any)
        // 2) Pay the admission month fee (monthly) next
        // 3) If there is extra amount, distribute across future months sequentially (advance payment)
        try {
            const months = getSessionYearMonths(session);
            const admissionDate = student?.admissionDate ? new Date(student.admissionDate) : paymentDate;
            const admYear = admissionDate.getFullYear();
            const admMonth = admissionDate.getMonth() + 1;
            const admIdx = months.findIndex((m) => m.year === admYear && m.month === admMonth);
            const startIdx = admIdx >= 0 ? admIdx : 0;

            let remainingToAllocate = initialAmount;

            // One-Time
            if (oneTimeTotalFromStructure > 0 && remainingToAllocate > 0) {
                const oneTime = await StudentFeeRepository.findByStudentMonth(
                    schoolId,
                    student._id.toString(),
                    session._id.toString(),
                    'One-Time'
                );
                if (oneTime && oneTime.status !== FeeStatus.PAID) {
                    const amt = Math.min(remainingToAllocate, oneTime.remainingAmount || 0);
                    if (amt > 0) {
                        await this.recordPayment(schoolId, oneTime._id.toString(), {
                            amount: amt,
                            mode: (data.paymentMode as any) || 'cash',
                            staffId: data.staffId,
                            transactionId: data.transactionId,
                            receiptNumber,
                            paymentDate,
                            remarks: 'Admission (one-time fees)',
                        } as any);
                        remainingToAllocate -= amt;
                    }
                }
            }

            // Monthly and advance months
            for (let i = startIdx; i < months.length && remainingToAllocate > 0; i++) {
                const m = months[i];
                const fee = await StudentFeeRepository.findByStudentMonth(
                    schoolId,
                    student._id.toString(),
                    session._id.toString(),
                    m.monthName
                );
                if (!fee || fee.status === FeeStatus.PAID) continue;
                const amt = Math.min(remainingToAllocate, fee.remainingAmount || 0);
                if (amt <= 0) continue;
                await this.recordPayment(schoolId, fee._id.toString(), {
                    amount: amt,
                    mode: (data.paymentMode as any) || 'cash',
                    staffId: data.staffId,
                    transactionId: data.transactionId,
                    receiptNumber,
                    paymentDate,
                    remarks: i === startIdx ? 'Admission (first month)' : 'Advance fee payment',
                } as any);
                remainingToAllocate -= amt;
            }
        } catch (_) {
            // Ledger allocation should not block admission if something goes wrong.
        }

        const school = await SchoolRepository.findById(schoolId);
        if (school) {
            // Resolve receipt month from StudentFee ledger rows for this receiptNumber.
            let feeMonth: string | undefined = undefined;
            try {
                const feeDoc = await StudentFee.findOne({
                    schoolId: new Types.ObjectId(schoolId),
                    studentId: payment.studentId,
                    sessionId: session._id,
                    'payments.receiptNumber': payment.receiptNumber,
                }).sort({ dueDate: -1 }).lean();
                feeMonth = feeDoc?.month ? String(feeDoc.month) : undefined;
            } catch (_) {
                // ignore and fallback
            }

            const concessionAnnualDisplay = this.concessionAnnualDisplayForReceipt(
                { ...student, concessionAmount: flatConcession, concessionPercent: pctConcession },
                structureForReceipt,
                session
            );
            const pdfBuffer = await generateReceiptPDF({
                school,
                payment,
                student: {
                    ...student,
                    totalYearlyFee: totalYearly,
                    paidAmount: initialAmount,
                    dueAmount: remainingDue,
                    concessionAmount: flatConcession,
                    concessionPercent: pctConcession,
                },
                totalAnnualFee: totalYearly,
                previousPaid: 0,
                thisPayment: initialAmount,
                remainingDue,
                sessionYear: session.sessionYear,
                feeMonth,
                concessionAnnualDisplay,
            });
            const receiptsDir = path.join(process.cwd(), 'receipts');
            if (!fs.existsSync(receiptsDir)) fs.mkdirSync(receiptsDir, { recursive: true });
            const pdfPath = path.join(receiptsDir, `${payment.receiptNumber.replace(/\//g, '-')}.pdf`);
            fs.writeFileSync(pdfPath, pdfBuffer);
            await FeePaymentRepository.update(payment._id.toString(), { pdfPath } as any);
        }
        return payment;
    }

    /**
     * Generate Monthly Fees for All Students in a Class
     */
    async generateMonthlyFees(
        schoolId: string,
        className: string,
        month: string,
        dueDate: Date
    ): Promise<{ created: number; skipped: number }> {
        const session = await SessionRepository.findActive(schoolId);
        if (!session) throw new ErrorResponse('No active session found', 400);

        // 1. Get Fee Structure
        const structure = await FeeStructureRepository.findByClass(
            schoolId,
            session._id.toString(),
            className
        );
        if (!structure) throw new ErrorResponse(`Fee structure not found for Class ${className}`, 404);

        // 2. Get Students in Class
        const students = await StudentRepository.find({
            schoolId,
            class: className,
            isActive: true
        });

        let createdCount = 0;
        let skippedCount = 0;

        // Batch-fetch existing fee records for all students in this class+month
        const studentIds = students.map(s => s._id);
        const existingFees = await StudentFee.find({
            schoolId: new Types.ObjectId(schoolId),
            sessionId: session._id,
            month,
            studentId: { $in: studentIds },
        }).select('studentId').lean();
        const existingStudentIds = new Set(existingFees.map((f: any) => f.studentId.toString()));

        // 3. Create Fee Records
        for (const student of students) {
            if (existingStudentIds.has(student._id.toString())) {
                skippedCount++;
                continue;
            }

            // Calculate Total
            const monthlyFees = (structure.fees || []).filter((f: any) => f.type === 'monthly');
            const monthlyTotal = monthlyFees.reduce((sum, f) => sum + f.amount, 0);

            await StudentFeeRepository.create({
                schoolId: new Types.ObjectId(schoolId) as any,
                studentId: student._id,
                sessionId: session._id,
                month,
                feeBreakdown: monthlyFees.map(f => ({
                    title: f.title,
                    amount: f.amount,
                    type: f.type
                })),
                totalAmount: monthlyTotal,
                paidAmount: 0,
                remainingAmount: monthlyTotal,
                status: FeeStatus.PENDING,
                dueDate,
                payments: [],
                discount: 0,
                lateFee: 0
            });
            createdCount++;
        }

        return { created: createdCount, skipped: skippedCount };
    }

    /**
     * Record Fee Payment
     */
    async recordPayment(
        schoolId: string,
        feeId: string,
        paymentData: {
            amount: number;
            mode: PaymentMode;
            staffId: string;
            remarks?: string;
            transactionId?: string;
            receiptNumber?: string;
            paymentDate?: Date;
        }
    ): Promise<IStudentFee> {
        const feeRecord = await StudentFeeRepository.findById(feeId);

        if (!feeRecord) throw new ErrorResponse('Fee record not found', 404);
        if (feeRecord.schoolId.toString() !== schoolId) {
            throw new ErrorResponse('Unauthorized access to fee record', 403);
        }

        if (feeRecord.status === FeeStatus.PAID) {
            throw new ErrorResponse('Fee already fully paid', 400);
        }

        if (feeRecord.status === FeeStatus.EXEMPT) {
            throw new ErrorResponse('Fee is exempt for this month', 400);
        }

        if (paymentData.amount <= 0) {
            throw new ErrorResponse('Invalid payment amount', 400);
        }

        const newPaidAmount = feeRecord.paidAmount + paymentData.amount;
        if (newPaidAmount > feeRecord.totalAmount + feeRecord.lateFee - feeRecord.discount) {
            throw new ErrorResponse('Payment exceeds remaining amount', 400);
        }

        // Add Payment
        feeRecord.payments.push({
            amount: paymentData.amount,
            paymentDate: paymentData.paymentDate ? new Date(paymentData.paymentDate) : new Date(),
            paymentMode: paymentData.mode,
            receiptNumber: paymentData.receiptNumber,
            receivedBy: new Types.ObjectId(paymentData.staffId) as any,
            remarks: paymentData.remarks,
            transactionId: paymentData.transactionId,
        });

        feeRecord.paidAmount = newPaidAmount;
        feeRecord.remainingAmount = feeRecord.totalAmount + (feeRecord.lateFee || 0) - (feeRecord.discount || 0) - newPaidAmount;
        if (feeRecord.remainingAmount <= 0) feeRecord.status = FeeStatus.PAID;

        await feeRecord.save();
        this.invalidateFeeCachesForSchool(schoolId);
        return feeRecord;
    }

    /**
     * Get Student Ledger
     */
    async getStudentLedger(schoolId: string, studentId: string): Promise<IStudentFee[]> {
        const session = await SessionRepository.findActive(schoolId);
        if (!session) throw new ErrorResponse('No active session found', 400);

        return await StudentFeeRepository.findByStudent(schoolId, studentId, session._id.toString());
    }

    /**
     * Get Collection Report
     */
    async getCollectionReport(schoolId: string, month?: string): Promise<{ total: number }> {
        const session = await SessionRepository.findActive(schoolId);
        if (!session) throw new ErrorResponse('No active session found', 400);

        const total = await StudentFeeRepository.sumCollection(schoolId, session._id.toString(), month);
        return { total };
    }

    /**
     * List all student fees with filters
     */
    async listAllFees(schoolId: string, filters: any): Promise<IStudentFee[]> {
        const filter = getTenantFilter(schoolId, filters);
        return await StudentFee.find(filter)
            .populate('studentId', 'firstName lastName admissionNumber photo')
            .populate('sessionId', 'name')
            .sort({ createdAt: -1 })
            .lean().exec() as unknown as IStudentFee[];
    }

    async listAllFeesPaged(
        schoolId: string,
        filters: any,
        page: number,
        limit: number
    ): Promise<{ items: IStudentFee[]; total: number }> {
        const filter = getTenantFilter(schoolId, filters);
        const safePage = Math.max(1, Math.floor(page || 1));
        const safeLimit = Math.max(1, Math.min(500, Math.floor(limit || 50)));
        const skip = (safePage - 1) * safeLimit;
        const [items, total] = await Promise.all([
            StudentFee.find(filter)
                .select('studentId sessionId month totalAmount paidAmount remainingAmount status dueDate discount lateFee createdAt updatedAt')
                .populate('studentId', 'firstName lastName admissionNumber photo')
                .populate('sessionId', 'name')
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(safeLimit)
                .lean()
                .exec() as unknown as IStudentFee[],
            StudentFee.countDocuments(filter),
        ]);
        return { items, total };
    }

    /**
     * Quick collect fee: find or create a fee record for student+month and record payment
     */
    async collectFee(
        schoolId: string,
        payload: {
            studentId: string;
            amount: number;
            month?: string;
            feeTitle?: string;
            mode: PaymentMode;
            transactionId?: string;
            remarks?: string;
            staffId: string;
        }
    ): Promise<IStudentFee> {
        const session = await SessionRepository.findActive(schoolId);
        if (!session) throw new ErrorResponse('No active session found', 400);

        const targetMonthName = payload.month || new Date().toLocaleString('default', { month: 'long' });
        const months = getSessionYearMonths(session);
        const targetIndex = months.findIndex((m) => m.monthName === targetMonthName);
        if (targetIndex < 0) {
            throw new ErrorResponse(`Invalid month: ${targetMonthName}`, 400);
        }

        // Create receipt metadata early so it can be stored inside StudentFee ledger
        // allocations (this is required for receipt PDF month resolution).
        const yearPrefix = session.sessionYear ? session.sessionYear.split('-')[0] : String(new Date().getFullYear());
        const receiptNumber = await FeePaymentRepository.getNextReceiptNumber(schoolId, yearPrefix);
        const paymentDate = new Date();

        // Ensure ledger exists so we have one row per month.
        const student = await StudentRepository.findById(payload.studentId);
        if (student) {
            await this.ensureStudentFeeLedgerForActiveSession(schoolId, student);
        }

        const allFees = await StudentFee.find({
            schoolId: new Types.ObjectId(schoolId),
            sessionId: session._id,
            studentId: new Types.ObjectId(payload.studentId),
        }).exec();
        const monthToFee: Record<string, any> = {};
        for (const fee of allFees as any[]) {
            monthToFee[(fee.month || '').toString()] = fee;
        }

        let remaining = payload.amount;
        let lastUpdatedFee: IStudentFee | null = null;

        for (let i = 0; i <= targetIndex && remaining > 0; i++) {
            const m = months[i];
            const fee = monthToFee[m.monthName];
            if (!fee || fee.status === FeeStatus.PAID || fee.status === FeeStatus.EXEMPT) continue;

            const remainingForMonth =
                (fee.totalAmount || 0) + (fee.lateFee || 0) - (fee.discount || 0) - (fee.paidAmount || 0);
            const amtForMonth = Math.min(remaining, remainingForMonth);
            if (amtForMonth <= 0) continue;

            lastUpdatedFee = await this.recordPayment(schoolId, fee._id.toString(), {
                amount: amtForMonth,
                mode: payload.mode,
                staffId: payload.staffId,
                transactionId: payload.transactionId,
                remarks: payload.remarks,
                receiptNumber,
                paymentDate,
            });
            remaining -= amtForMonth;
        }

        if (remaining > 0.01) {
            // User is trying to pay more than the due up to the selected month.
            throw new ErrorResponse('Payment exceeds remaining amount for selected months', 400);
        }

        if (!lastUpdatedFee) {
            if (monthToFee[targetMonthName]?.status === FeeStatus.EXEMPT && payload.amount > 0.01) {
                throw new ErrorResponse('Fee is exempt for this month', 400);
            }
            throw new ErrorResponse('No pending fees found for selected months', 400);
        }

        // Create a FeePayment record so the receipt appears in the month
        // when the cash was actually received (based on paymentDate).
        await FeePaymentRepository.create({
            schoolId: new Types.ObjectId(schoolId) as any,
            studentId: new Types.ObjectId(payload.studentId) as any,
            receiptNumber,
            amountPaid: payload.amount,
            paymentMode: payload.mode,
            paymentDate,
            previousDue: 0,
            remainingDue: 0,
            transactionId: payload.transactionId,
        } as any);

        this.invalidateFeeCachesForSchool(schoolId);
        return lastUpdatedFee;
    }

    /**
     * Get today's collection with payment mode breakdown
     */
    async getTodayCollection(schoolId: string): Promise<{
        total: number;
        byPaymentMode: { mode: string; amount: number }[];
        transactionCount: number;
    }> {
        const schoolObjId = new Types.ObjectId(schoolId);
        const FeePayment = (await import('../models/feePayment.model')).default;

        const today = new Date();
        const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);

        const [payments, count] = await Promise.all([
            FeePayment.aggregate([
                { $match: { schoolId: schoolObjId, paymentDate: { $gte: startOfDay, $lt: endOfDay } } },
                { $group: { _id: '$paymentMode', amount: { $sum: '$amountPaid' } } },
                { $sort: { amount: -1 } },
            ]),
            FeePayment.countDocuments({ schoolId: schoolObjId, paymentDate: { $gte: startOfDay, $lt: endOfDay } }),
        ]);

        const total = payments.reduce((sum, p) => sum + (p.amount || 0), 0);
        const byPaymentMode = payments.map((p: any) => ({
            mode: p._id || 'other',
            amount: p.amount || 0,
        }));

        return { total, byPaymentMode, transactionCount: count };
    }

    /**
     * Get fee summary stats for dashboard (yearly + monthly fee data)
     */
    async getFeeStats(schoolId: string): Promise<{
        totalCollected: number;
        outstanding: number;
        collectionRate: number;
        transactionCount: number;
        totalExpected?: number;
        defaulterCount?: number;
        monthlyCollection?: { month: string; amount: number }[];
    }> {
        const schoolObjId = new Types.ObjectId(schoolId);
        const FeePayment = (await import('../models/feePayment.model')).default;
        const [collected, pending, monthlyCount, yearlyExpected, yearlyCollected, yearlyPending, defaulterCount, paymentCount, monthlyPayments] = await Promise.all([
            StudentFee.aggregate([
                { $match: { schoolId: schoolObjId, status: 'paid' } },
                { $group: { _id: null, total: { $sum: '$paidAmount' } } }
            ]),
            StudentFee.aggregate([
                { $match: { schoolId: schoolObjId, status: { $in: ['pending', 'partial'] } } },
                { $group: { _id: null, total: { $sum: '$remainingAmount' } } }
            ]),
            StudentFee.countDocuments({ schoolId: schoolObjId }),
            Student.aggregate([
                { $match: { schoolId: schoolObjId, isActive: true, totalYearlyFee: { $gt: 0 } } },
                { $group: { _id: null, total: { $sum: '$totalYearlyFee' } } }
            ]),
            Student.aggregate([
                { $match: { schoolId: schoolObjId, isActive: true } },
                { $group: { _id: null, total: { $sum: '$paidAmount' } } }
            ]),
            Student.aggregate([
                { $match: { schoolId: schoolObjId, isActive: true, dueAmount: { $gt: 0 } } },
                { $group: { _id: null, total: { $sum: '$dueAmount' } } }
            ]),
            Student.countDocuments({ schoolId: schoolObjId, isActive: true, dueAmount: { $gt: 0 } }),
            FeePayment.countDocuments({ schoolId: schoolObjId }),
            // Use aggregation pipeline instead of loading all payments into memory
            FeePayment.aggregate([
                { $match: { schoolId: schoolObjId } },
                {
                    $group: {
                        _id: { $dateToString: { format: '%Y-%m', date: '$paymentDate' } },
                        amount: { $sum: '$amountPaid' },
                    }
                },
                { $sort: { _id: 1 } },
                { $project: { _id: 0, month: '$_id', amount: 1 } },
            ]).then((results: any[]) => results.slice(-12)),
        ]);
        const yearlyCollectedTotal = yearlyCollected[0]?.total ?? 0;
        const yearlyPendingTotal = yearlyPending[0]?.total ?? 0;
        const monthlyFeeCollected = collected[0]?.total ?? 0;
        const monthlyFeePending = pending[0]?.total ?? 0;
        const totalCollected = yearlyCollectedTotal || monthlyFeeCollected;
        const outstanding = yearlyPendingTotal || monthlyFeePending;
        const totalExpected = yearlyExpected[0]?.total ?? 0;
        const totalExpectedAll = totalExpected || totalCollected + outstanding;
        const collectionRate = totalExpectedAll > 0 ? Math.round((totalCollected / totalExpectedAll) * 100) : 0;
        return {
            totalCollected,
            outstanding,
            collectionRate,
            transactionCount: paymentCount + monthlyCount,
            totalExpected: totalExpectedAll || undefined,
            defaulterCount,
            monthlyCollection: monthlyPayments as { month: string; amount: number }[],
        };
    }

    /**
     * Get monthly fee stats and payment records for a specific month
     */
    async getMonthlyFeeData(
        schoolId: string,
        year: number,
        month: number
    ): Promise<{
        stats: { totalCollected: number; totalExpected: number; totalPending: number; collectionRate: number; transactionCount: number };
        payments: Array<IFeePayment & { paymentDetail?: string; appliedMonths?: string[] }>;
    }> {
        const session = await SessionRepository.findActive(schoolId);
        if (!session) throw new ErrorResponse('No active session found', 400);

        const months = getSessionYearMonths(session);
        const selected = months.find((m) => m.year === year && m.month === month);
        if (!selected) {
            // If user selects a month outside the active session, just return empty stats.
            return {
                stats: { totalCollected: 0, totalExpected: 0, totalPending: 0, collectionRate: 0, transactionCount: 0 },
                payments: [],
            };
        }

        const [feeRecords, rawPayments] = await Promise.all([
            StudentFee.find({
                schoolId: new Types.ObjectId(schoolId),
                sessionId: session._id,
                month: selected.monthName,
            })
                .populate('studentId', 'firstName lastName admissionNumber class section')
                .lean(),
            // Payments whose cash date falls in this calendar month
            FeePaymentRepository.findPaymentsByMonth(schoolId, year, month),
        ]);

        // Exclude deleted students so they don't show as Unknown; exempt months do not count toward totals.
        const validFees = (feeRecords as any[]).filter(
            (f) => f.studentId && (f.status || '').toString() !== FeeStatus.EXEMPT
        );

        const monthStart = new Date(year, month - 1, 1, 0, 0, 0, 0);

        // "Collected (Month)" should mean cash physically received in the selected
        // calendar month, even if that money was adjusted against future months.
        const payments = rawPayments.filter((p: any) => p.studentId);
        const totalCollected = payments.reduce((sum: number, p: any) => sum + (Number(p.amountPaid) || 0), 0);

        // Build a receipt -> applied month(s) map from StudentFee ledger.
        // This lets UI show "One-Time fee paid" or "March fee paid".
        const receiptNumbers = [...new Set(
            payments
                .map((p: any) => String(p.receiptNumber || '').trim())
                .filter(Boolean)
        )];

        const receiptToMonths = new Map<string, string[]>();
        if (receiptNumbers.length) {
            const feeDocs = await StudentFee.find({
                schoolId: new Types.ObjectId(schoolId),
                'payments.receiptNumber': { $in: receiptNumbers },
            })
                .select('month payments.receiptNumber')
                .lean();

            for (const doc of feeDocs as any[]) {
                const feeMonth = String(doc?.month || '').trim();
                if (!feeMonth) continue;
                const rows = Array.isArray(doc?.payments) ? doc.payments : [];
                for (const row of rows) {
                    const rn = String(row?.receiptNumber || '').trim();
                    if (!rn) continue;
                    const existing = receiptToMonths.get(rn) || [];
                    if (!existing.includes(feeMonth)) existing.push(feeMonth);
                    receiptToMonths.set(rn, existing);
                }
            }
        }

        const paymentsWithDetail = payments.map((p: any) => {
            // Preserve all real document fields when enriching.
            const paymentObj =
                p && typeof p.toObject === 'function'
                    ? p.toObject()
                    : p;

            const rn = String(paymentObj?.receiptNumber || '').trim();
            const appliedMonths = rn ? (receiptToMonths.get(rn) || []) : [];
            const uniqueMonths = [...new Set(appliedMonths)];
            let paymentDetail = 'Fee paid';
            if (uniqueMonths.length === 1) {
                paymentDetail =
                    uniqueMonths[0] === 'One-Time'
                        ? 'One-time fee paid'
                        : `${uniqueMonths[0]} fee paid`;
            } else if (uniqueMonths.length > 1) {
                paymentDetail = `Fees paid (${uniqueMonths.join(', ')})`;
            }
            return {
                ...paymentObj,
                appliedMonths: uniqueMonths,
                paymentDetail,
            };
        });

        // "Expected (Month)" should mean what was still due for this academic month
        // at the start of the selected month. If a student prepaid this month earlier
        // (e.g. April paid in March), expected becomes 0 for April.
        const totalExpected = validFees.reduce((sum, f: any) => {
            const paymentsBeforeMonth = Array.isArray(f.payments)
                ? f.payments.reduce((inner: number, p: any) => {
                    const paymentDate = p?.paymentDate ? new Date(p.paymentDate) : null;
                    if (!paymentDate || Number.isNaN(paymentDate.getTime()) || paymentDate >= monthStart) {
                        return inner;
                    }
                    return inner + (Number(p.amount) || 0);
                }, 0)
                : 0;

            const expectedAtMonthStart = Math.max(0, (Number(f.totalAmount) || 0) - paymentsBeforeMonth);
            return sum + expectedAtMonthStart;
        }, 0);

        // "Pending (Month)" is the amount for this academic month still unpaid now.
        const totalPending = validFees.reduce((sum, f) => sum + Math.max(0, Number(f.remainingAmount) || 0), 0);

        const collectionRate =
            totalExpected > 0 ? Math.round(((totalExpected - totalPending) / totalExpected) * 100) : 100;

        return {
            stats: {
                totalCollected,
                totalExpected,
                totalPending,
                collectionRate,
                transactionCount: payments.length,
            },
            payments: paymentsWithDetail,
        };
    }
}

export default new FeeService();
