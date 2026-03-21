import { IFeeStructure, IStudentFee, IFeePayment, FeeStatus, PaymentMode } from '../types';
import FeeStructureRepository from '../repositories/feeStructure.repository';
import FeePaymentRepository from '../repositories/feePayment.repository';
import StudentFeeRepository from '../repositories/studentFee.repository';
import StudentRepository from '../repositories/student.repository';
import SessionRepository from '../repositories/session.repository';
import SchoolRepository from '../repositories/school.repository';
import ErrorResponse from '../utils/errorResponse';
import { Types } from 'mongoose';
import StudentFee from '../models/studentFee.model';
import Student from '../models/student.model';
import { getTenantFilter } from '../utils/tenant';
import { generateFeeStructurePDF } from './pdfFeeStructure.service';
import { generateReceiptPDF } from './pdfReceipt.service';
import path from 'path';
import fs from 'fs';

class FeeService {
    private static readonly MONTHS = [
        'January',
        'February',
        'March',
        'April',
        'May',
        'June',
        'July',
        'August',
        'September',
        'October',
        'November',
        'December',
    ];

    private getSessionYearMonths(session: any): Array<{ year: number; month: number; monthName: string }> {
        const start = new Date(session.startDate);
        const end = new Date(session.endDate);
        const result: Array<{ year: number; month: number; monthName: string }> = [];

        let y = start.getFullYear();
        let m = start.getMonth() + 1; // 1-based
        while (y < end.getFullYear() || (y === end.getFullYear() && m <= end.getMonth() + 1)) {
            result.push({ year: y, month: m, monthName: FeeService.MONTHS[m - 1] });
            m++;
            if (m > 12) {
                m = 1;
                y++;
            }
        }
        return result;
    }

    private async ensureStudentFeeLedgerForActiveSession(schoolId: string, student: any): Promise<void> {
        const session = await SessionRepository.findActive(schoolId);
        if (!session) return;
        if (!student?.class) return;

        const structure = await FeeStructureRepository.findByClass(schoolId, session._id.toString(), student.class);
        if (!structure) return;

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

        const months = this.getSessionYearMonths(session);

        // Apply student-level concession to monthly fee per month.
        // concessionAmount reduces the total annual monthly bill; the saving is
        // spread evenly across all session months.
        const concession = Number((student as any).concessionAmount) || 0;
        const sessionMonthCount = months.length || 12;

        // Important: don't use Math.round per-month here, because it can slightly change the
        // effective annual concession (e.g., 6000 turning into 5997) due to rounding drift.
        // Instead, distribute the remaining rupees across months so the TOTAL matches exactly.
        // Example: if annualMonthlyAfter = 5997 and months = 12 -> 9 months get +1.
        const annualMonthlyAfter = concession > 0 && monthlyTotal > 0
            ? Math.max(0, (monthlyTotal * sessionMonthCount) - concession)
            : (monthlyTotal * sessionMonthCount);

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
                dueDate: new Date(m.year, m.month, 0, 23, 59, 59), // last day of month
                payments: [],
                discount: 0,
                lateFee: 0,
            } as any);
        }

        // One-time ledger entry (collected at admission)
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

        const payload: any = {
            ...data,
            schoolId: new Types.ObjectId(schoolId),
            sessionId: session._id,
        };
        if (data.classId) payload.classId = new Types.ObjectId(String(data.classId));
        if (data.components && data.components.length > 0) {
            payload.components = data.components;
            // totalAmount/totalAnnualFee computed by model pre-save (monthly×12 + one-time)
        }
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
        const existing = await FeeStructureRepository.findById(structureId);
        if (!existing || existing.schoolId.toString() !== schoolId) return null;
        if (data.components && data.components.length > 0) {
            // totalAmount/totalAnnualFee will be recomputed by model pre-save on next save
            // update() may not run pre-save; fetch, set components, save to trigger hook
            const existing = await FeeStructureRepository.findById(structureId);
            if (existing) {
                (existing as any).components = data.components;
                await (existing as any).save();
                return existing;
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

    async getStructurePrintPdf(schoolId: string, structureId: string): Promise<Buffer> {
        const structure = await FeeStructureRepository.findById(structureId);
        if (!structure || structure.schoolId.toString() !== schoolId) {
            throw new ErrorResponse('Fee structure not found', 404);
        }
        const school = await SchoolRepository.findById(schoolId);
        const session = await SessionRepository.findActive(schoolId);
        if (!school || !session) throw new ErrorResponse('School or session not found', 404);
        return await generateFeeStructurePDF({ school, session, structure });
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
        let totalYearly = student.totalYearlyFee ?? 0;
        if (totalYearly === 0 && student.class) {
            const structure = await FeeStructureRepository.findByClass(
                schoolId,
                (await SessionRepository.findActive(schoolId))?._id?.toString() || '',
                student.class
            );
            if (structure) {
                totalYearly = structure.totalAmount ?? structure.totalAnnualFee ?? 0;
                await StudentRepository.update(payload.studentId, {
                    totalYearlyFee: totalYearly,
                    dueAmount: totalYearly - (student.paidAmount ?? 0),
                } as any);
            }
        }
        const previousPaid = student.paidAmount ?? 0;
        const dueBefore = (student as any).dueAmount ?? totalYearly - previousPaid;
        if (payload.amountPaid <= 0) throw new ErrorResponse('Invalid payment amount', 400);
        if (payload.amountPaid > dueBefore) throw new ErrorResponse('Payment exceeds remaining due', 400);

        const session = await SessionRepository.findActive(schoolId);
        if (!session) throw new ErrorResponse('No active session', 400);
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
            await this.ensureStudentFeeLedgerForActiveSession(schoolId, student);
            const months = this.getSessionYearMonths(session);
            let remaining = payload.amountPaid;
            for (const m of months) {
                if (remaining <= 0) break;
                const fee = await StudentFeeRepository.findByStudentMonth(
                    schoolId,
                    payload.studentId,
                    session._id.toString(),
                    m.monthName
                );
                if (!fee || fee.status === FeeStatus.PAID) continue;
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
        if (student.class) {
            const feeStructure = await FeeStructureRepository.findByClass(
                schoolId,
                session._id.toString(),
                student.class
            );
            if (feeStructure) {
                const items = (feeStructure.components && feeStructure.components.length > 0)
                    ? feeStructure.components
                    : (feeStructure.fees || []).map((f: any) => ({ name: f.title || f.name, amount: f.amount, type: f.type }));
                feeComponents = items.map((c: any) => ({
                    name: c.name,
                    amount: c.type === 'one-time' ? c.amount : c.amount * 12,
                }));
            }
        }

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
            totalAnnualFee: totalYearly,
            previousPaid,
            thisPayment: payload.amountPaid,
            remainingDue,
            sessionYear: session.sessionYear,
            feeComponents,
            feeMonth,
        });

        const receiptsDir = path.join(process.cwd(), 'receipts');
        if (!fs.existsSync(receiptsDir)) fs.mkdirSync(receiptsDir, { recursive: true });
        const pdfPath = path.join(receiptsDir, `${payment.receiptNumber.replace(/\//g, '-')}.pdf`);
        fs.writeFileSync(pdfPath, pdfBuffer);
        await FeePaymentRepository.update(payment._id.toString(), { pdfPath } as any);

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
    ): Promise<{ student: any; payments: IFeePayment[]; monthlyFee?: number; oneTimeFee?: number } | null> {
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

                    // Apply student-level concession so the Collect Fee modal
                    // shows the correct per-month amount for this student.
                    const studentConcession = Number((student as any).concessionAmount) || 0;
                    let effectiveMonthlyFee = monthlyTotal;
                    if (studentConcession > 0 && monthlyTotal > 0) {
                        const sessionMonthCount = session
                            ? (this.getSessionYearMonths(session).length || 12)
                            : 12;
                        effectiveMonthlyFee = Math.max(
                            0,
                            Math.round(((monthlyTotal * sessionMonthCount) - studentConcession) / sessionMonthCount)
                        );
                    }

                    monthlyFee = effectiveMonthlyFee > 0 ? effectiveMonthlyFee : undefined;
                    oneTimeFee = oneTimeTotal > 0 ? oneTimeTotal : undefined;

                    // Back-fill totalYearlyFee on student if it was missing.
                    if (totalFromStudent === 0) {
                        const annualTotal =
                            structure.totalAmount ??
                            structure.totalAnnualFee ??
                            monthlyTotal * 12 + oneTimeTotal;
                        await StudentRepository.update(studentId, {
                            totalYearlyFee: annualTotal,
                            dueAmount: annualTotal - ((student as any).paidAmount ?? 0),
                        } as any);
                        const updated = await StudentRepository.findById(studentId);
                        if (updated) {
                            const payments = await FeePaymentRepository.findByStudent(schoolId, studentId);
                            return { student: updated, payments, monthlyFee, oneTimeFee };
                        }
                    }
                }
            }
        }
        const payments = await FeePaymentRepository.findByStudent(schoolId, studentId);
        return { student, payments, monthlyFee, oneTimeFee };
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
        if (student.class && session) {
            const feeStructure = await FeeStructureRepository.findByClass(
                schoolId, session._id.toString(), student.class
            );
            if (feeStructure) {
                const rawItems = ((feeStructure.components ?? []).length > 0)
                    ? (feeStructure.components ?? [])
                    : (feeStructure.fees || []).map((f: any) => ({ name: f.title || f.name, amount: f.amount, type: f.type }));
                feeComponents = rawItems.map((c: any) => ({
                    name: c.name,
                    amount: c.type === 'one-time' ? c.amount : c.amount * 12,
                }));
            }
        }

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
        });
    }

    async listFeePayments(schoolId: string, limit = 200, studentId?: string): Promise<IFeePayment[]> {
        const payments = studentId
            ? await FeePaymentRepository.findByStudent(schoolId, studentId)
            : await FeePaymentRepository.findPaymentsBySchool(schoolId, limit);

        // Hide payments for students that have been deleted (studentId failed to populate),
        // so receipts list does not show \"Unknown\" rows.
        return payments.filter((p: any) => p.studentId);
    }

    async getDefaulters(schoolId: string): Promise<any[]> {
        const schoolObjId = new Types.ObjectId(schoolId);
        const today = new Date();
        const currentYear = today.getFullYear();
        const currentMonthIndex = today.getMonth(); // 0-based

        const session = await SessionRepository.findActive(schoolId);
        const structures = session ? await FeeStructureRepository.findBySession(schoolId, session._id.toString()) : [];
        const classFeeParts = new Map<string, { monthlyTotal: number; oneTimeTotal: number }>();
        for (const s of structures as any[]) {
            const rawItems: Array<{ amount: number; type?: string }> =
                (s.components && s.components.length > 0)
                    ? s.components
                    : (s.fees || []).map((f: any) => ({ amount: f.amount, type: f.type }));
            let monthlyTotal = 0;
            let oneTimeTotal = 0;
            for (const item of rawItems) {
                if (!item || typeof item.amount !== 'number') continue;
                const t = (item.type || '').toString().toLowerCase();
                if (t === 'one-time' || t === 'one_time' || t === 'one time') oneTimeTotal += item.amount;
                else if (t === 'monthly') monthlyTotal += item.amount;
            }
            if (s.class) classFeeParts.set(String(s.class), { monthlyTotal, oneTimeTotal });
        }
        const getPartsForClass = (cls?: string) => {
            if (!cls) return null;
            const direct = classFeeParts.get(cls);
            if (direct) return direct;
            if (typeof cls === 'string' && cls.includes(' ')) {
                const first = classFeeParts.get(cls.split(' ')[0]);
                if (first) return first;
            }
            return null;
        };
        const expectedFromParts = (parts: { monthlyTotal: number; oneTimeTotal: number } | null, totalYearly: number, monthsCount: number) => {
            if (monthsCount <= 0) return 0;
            if (parts && (parts.monthlyTotal > 0 || parts.oneTimeTotal > 0)) {
                return Math.round(parts.oneTimeTotal + parts.monthlyTotal * monthsCount);
            }
            return Math.round((totalYearly / 12) * monthsCount);
        };

        const students = await Student.find({
            schoolId: schoolObjId,
            isActive: true,
            totalYearlyFee: { $gt: 0 },
        })
            .sort({ class: 1, section: 1 })
            .lean();

        const defaulters: any[] = [];

        for (const s of students as any[]) {
            const totalYearly: number = s.totalYearlyFee ?? 0;
            const paidAmount: number = s.paidAmount ?? 0;
            const admissionDate: Date | null = s.admissionDate ? new Date(s.admissionDate) : null;

            const startYear = admissionDate ? admissionDate.getFullYear() : currentYear;
            const startMonthIndex = admissionDate ? admissionDate.getMonth() : 0;

            let monthDiff =
                (currentYear - startYear) * 12 +
                (currentMonthIndex - startMonthIndex) +
                1;

            if (monthDiff <= 0) continue;
            if (monthDiff > 12) monthDiff = 12;

            // Defaulters = unpaid for previous months (not current month)
            const prevMonths = Math.max(0, monthDiff - 1);
            if (prevMonths <= 0) continue;

            const parts = getPartsForClass(s.class);
            const expectedTillPrev = Math.min(totalYearly, expectedFromParts(parts, totalYearly, prevMonths));

            if (paidAmount + 0.5 < expectedTillPrev) {
                const shortfallTillPrev = expectedTillPrev - paidAmount;
                defaulters.push({
                    ...s,
                    expectedTillPrev,
                    shortfallTillPrev,
                });
            }
        }

        return defaulters;
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
        const sessionMonths = this.getSessionYearMonths(session);
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
            .filter((f: any) => (f.status || '').toString() !== FeeStatus.PAID && (f.remainingAmount ?? 0) > 0)
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
        data: { initialDepositAmount: number; paymentMode?: string; depositDate?: Date; transactionId?: string; staffId: string; concessionAmount?: number }
    ): Promise<IFeePayment | null> {
        const session = await SessionRepository.findActive(schoolId);
        if (!session) return null;

        // Store concession on student before creating the ledger so that
        // ensureStudentFeeLedgerForActiveSession can read it and apply adjusted per-month amounts.
        const concession = Number(data.concessionAmount) || 0;
        if (concession > 0) {
            (student as any).concessionAmount = concession;
            await StudentRepository.update(student._id.toString(), { concessionAmount: concession } as any);
        }

        // Ensure per-month ledger exists for this student in this session.
        // This allows advance payments (e.g. paid in March for April) to reduce April's pending/expected.
        await this.ensureStudentFeeLedgerForActiveSession(schoolId, student);

        let totalYearly = student.totalYearlyFee ?? 0;
        let firstMonthFee = 0;
        let oneTimeTotalFromStructure = 0;

        // Derive yearly + first-month fee from fee structure when possible
        if (student.class) {
            const structure = await FeeStructureRepository.findByClass(
                schoolId,
                session._id.toString(),
                student.class
            );
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

                // Apply concession: reduces total annual monthly bill; per-month amount was
                // already baked into ledger entries via ensureStudentFeeLedgerForActiveSession.
                const sessionMonthCount = this.getSessionYearMonths(session).length || 12;
                const adjustedMonthlyAnnual = concession > 0
                    ? Math.max(0, monthlyTotal * sessionMonthCount - concession)
                    : monthlyTotal * sessionMonthCount;

                // Annual = adjusted monthly total + all one-time components
                const computedAnnual = adjustedMonthlyAnnual + oneTimeTotal;
                if (!totalYearly || totalYearly <= 0) {
                    totalYearly = computedAnnual;
                } else if (concession > 0) {
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
            ...(concession > 0 ? { concessionAmount: concession } : {}),
        } as any);

        // Allocate the deposit into the ledger:
        // 1) Pay One-Time fees first (if any)
        // 2) Pay the admission month fee (monthly) next
        // 3) If there is extra amount, distribute across future months sequentially (advance payment)
        try {
            const months = this.getSessionYearMonths(session);
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

            const pdfBuffer = await generateReceiptPDF({
                school,
                payment,
                student: { ...student, totalYearlyFee: totalYearly, paidAmount: initialAmount, dueAmount: remainingDue },
                totalAnnualFee: totalYearly,
                previousPaid: 0,
                thisPayment: initialAmount,
                remainingDue,
                sessionYear: session.sessionYear,
                feeMonth,
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

        // 3. Create Fee Records
        for (const student of students) {
            // Check if already exists
            const existing = await StudentFeeRepository.findByStudentMonth(
                schoolId,
                student._id.toString(),
                session._id.toString(),
                month
            );

            if (existing) {
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
            .sort({ createdAt: -1 });
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
        const months = this.getSessionYearMonths(session);
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
            if (!fee || fee.status === FeeStatus.PAID) continue;

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

        return lastUpdatedFee;
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
            (async () => {
                const payments = await FeePayment.find({ schoolId: schoolObjId }).lean();
                const byMonth: Record<string, number> = {};
                payments.forEach((p: any) => {
                    const d = new Date(p.paymentDate);
                    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
                    byMonth[key] = (byMonth[key] || 0) + (p.amountPaid || 0);
                });
                return Object.entries(byMonth)
                    .sort((a, b) => a[0].localeCompare(b[0]))
                    .slice(-12)
                    .map(([month, amount]) => ({ month, amount }));
            })(),
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
        payments: IFeePayment[];
    }> {
        const session = await SessionRepository.findActive(schoolId);
        if (!session) throw new ErrorResponse('No active session found', 400);

        const months = this.getSessionYearMonths(session);
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

        // Exclude deleted students so they don't show as Unknown
        const validFees = (feeRecords as any[]).filter((f) => f.studentId);

        const monthStart = new Date(year, month - 1, 1, 0, 0, 0, 0);

        // "Collected (Month)" should mean cash physically received in the selected
        // calendar month, even if that money was adjusted against future months.
        const payments = rawPayments.filter((p: any) => p.studentId);
        const totalCollected = payments.reduce((sum: number, p: any) => sum + (Number(p.amountPaid) || 0), 0);

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
            payments,
        };
    }
}

export default new FeeService();
