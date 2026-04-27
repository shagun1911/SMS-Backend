import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import Class from '../models/class.model';
import { sendResponse } from '../utils/response';
import { getTenantFilter } from '../utils/tenant';
import ErrorResponse from '../utils/errorResponse';
import SessionRepository from '../repositories/session.repository';
import FeeStructureRepository from '../repositories/feeStructure.repository';
import TransportDestinationRepository from '../repositories/transportDestination.repository';
import FeePayment from '../models/feePayment.model';
import { computeReceiptAlignedStudentTotals } from '../utils/feeCalculator';
import { normalizeFeeExemptMonths, getSessionYearMonths } from '../utils/feeExemptMonths';
import FeeService from '../services/fee.service';

class ClassController {
    async getClasses(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const filter = getTenantFilter(req.schoolId!);
            const page = parseInt(req.query.page as string, 10) || 1;
            const limit = Math.min(parseInt(req.query.limit as string, 10) || 200, 500);
            const safePage = Math.max(1, page);
            const skip = (safePage - 1) * limit;
            const [classes, total] = await Promise.all([
                Class.find(filter)
                    .select('className section roomNumber capacity classTeacherId isActive createdAt updatedAt')
                    .populate('classTeacherId', 'name')
                    .sort({ className: 1, section: 1 })
                    .skip(skip)
                    .limit(limit)
                    .lean(),
                Class.countDocuments(filter),
            ]);
            res.setHeader('X-Total-Count', String(total));
            res.setHeader('X-Page', String(safePage));
            res.setHeader('X-Limit', String(limit));
            return sendResponse(res, classes, 'Classes retrieved', 200);
        } catch (error) {
            return next(error);
        }
    }

    async createClass(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const { className, section, roomNumber, capacity, classTeacherId } = req.body;
            if (!className || !section) {
                return next(new ErrorResponse('className and section are required', 400));
            }
            const sectionNorm = String(section).trim().toUpperCase();
            const existing = await Class.findOne({
                schoolId: req.schoolId,
                className: String(className).trim(),
                section: sectionNorm,
            });
            if (existing) {
                return next(new ErrorResponse(`Class ${className} Section ${sectionNorm} already exists`, 400));
            }
            const cls = await Class.create({
                schoolId: req.schoolId,
                className: String(className).trim(),
                section: sectionNorm,
                roomNumber: roomNumber || undefined,
                capacity: capacity != null ? Number(capacity) : undefined,
                classTeacherId: classTeacherId || undefined,
            });
            return sendResponse(res, cls, 'Class created', 201);
        } catch (error: any) {
            if (error.code === 11000) {
                return next(new ErrorResponse('This class and section combination already exists', 400));
            }
            return next(error);
        }
    }

    async updateClass(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const cls = await Class.findOne({ _id: req.params.id, schoolId: req.schoolId });
            if (!cls) {
                return next(new ErrorResponse('Class not found', 404));
            }
            const { roomNumber, capacity, classTeacherId, isActive } = req.body;
            const updated = await Class.findByIdAndUpdate(
                req.params.id,
                { roomNumber, capacity, classTeacherId, isActive },
                { new: true, runValidators: true }
            );
            return sendResponse(res, updated, 'Class updated', 200);
        } catch (error) {
            return next(error);
        }
    }

    async deleteClass(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const cls = await Class.findOne({ _id: req.params.id, schoolId: req.schoolId });
            if (!cls) {
                return next(new ErrorResponse('Class not found', 404));
            }
            await Class.findByIdAndDelete(req.params.id);
            return sendResponse(res, {}, 'Class deleted', 200);
        } catch (error) {
            return next(error);
        }
    }

    async getClassStudents(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const Student = (await import('../models/student.model')).default;
            const cls = await Class.findOne({ _id: req.params.id, schoolId: req.schoolId });
            if (!cls) {
                return next(new ErrorResponse('Class not found', 404));
            }
            const section = (cls as any).section ?? (cls as any).sections?.[0] ?? 'A';
            const filter = { schoolId: req.schoolId, class: cls.className, section, isActive: true };
            const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
            const limit = Math.min(parseInt(req.query.limit as string, 10) || 100, 500);
            const skip = (page - 1) * limit;
            const [students, total] = await Promise.all([
                Student.find(filter)
                    .select('firstName lastName admissionNumber class section rollNumber phone username fatherName photo totalYearlyFee paidAmount dueAmount')
                    .sort({ rollNumber: 1, firstName: 1 })
                    .skip(skip)
                    .limit(limit)
                    .lean(),
                Student.countDocuments(filter),
            ]);

            // Keep class card dues aligned with receipt-style fee math.
            const session = await SessionRepository.findActive(req.schoolId!);
            let studentsOut: any[] = students as any[];
            if (session && studentsOut.length > 0) {
                const byClass = new Map<string, any | null>();
                const byTransportId = new Map<string, number>();
                const studentIds = studentsOut.map((s: any) => s._id);
                const payments = await FeePayment.find({
                    schoolId: req.schoolId,
                    studentId: { $in: studentIds },
                })
                    .select('studentId amountPaid')
                    .lean();
                const paidByStudent = new Map<string, number>();
                for (const p of payments as any[]) {
                    const sid = String(p.studentId);
                    paidByStudent.set(sid, (paidByStudent.get(sid) || 0) + (Number(p.amountPaid) || 0));
                }

                const sessionMonths = getSessionYearMonths(session);
                for (const s of studentsOut) {
                    const sid = String((s as any)._id);
                    const classKey = String((s as any).class || '').trim();
                    if (!classKey) continue;

                    if (!byClass.has(classKey)) {
                        const structure = await FeeStructureRepository.findByClass(
                            req.schoolId!,
                            session._id.toString(),
                            classKey
                        );
                        byClass.set(classKey, structure || null);
                    }
                    const structure = byClass.get(classKey);
                    if (!structure) continue;

                    let transportMonthlyFee = 0;
                    const transportId = String((s as any).transportDestinationId || '').trim();
                    if ((s as any).usesTransport && transportId) {
                        if (!byTransportId.has(transportId)) {
                            const destination = await TransportDestinationRepository.findById(transportId);
                            byTransportId.set(transportId, Number(destination?.monthlyFee) || 0);
                        }
                        transportMonthlyFee = byTransportId.get(transportId) || 0;
                    }

                    const totals = computeReceiptAlignedStudentTotals({
                        student: s,
                        structure,
                        session,
                        transportMonthlyFee,
                        paidAmount: paidByStudent.get(sid) || 0,
                    });
                    const concessionForDisplay = (() => {
                        const rawItems: Array<{ amount: number; type?: string }> =
                            (structure as any).components && (structure as any).components.length > 0
                                ? (structure as any).components
                                : ((structure as any).fees || []).map((f: any) => ({
                                      amount: f.amount,
                                      type: f.type,
                                  }));
                        let monthlyTotalNoTransport = 0;
                        for (const item of rawItems) {
                            if (!item || typeof item.amount !== 'number') continue;
                            const t = (item.type || '').toString().toLowerCase();
                            if (t === 'monthly') monthlyTotalNoTransport += item.amount;
                        }
                        const exemptCanon = normalizeFeeExemptMonths(
                            (structure as any).feeExemptMonths,
                            sessionMonths.map((m) => m.monthName)
                        );
                        const chargeable = Math.max(
                            1,
                            sessionMonths.filter((m) => !exemptCanon.has(m.monthName)).length
                        );
                        const annualRecurringNoTransport = monthlyTotalNoTransport * chargeable;
                        const flat = Math.max(0, Math.round(Number((s as any).concessionAmount) || 0));
                        const pct = Math.min(100, Math.max(0, Number((s as any).concessionPercent) || 0));
                        const fromPct =
                            pct > 0 ? Math.round((annualRecurringNoTransport * pct) / 100) : 0;
                        const display = Math.min(annualRecurringNoTransport, flat + fromPct);
                        return Math.max(0, display);
                    })();
                    const totalAfterConcession = Math.max(0, totals.grossAnnual - concessionForDisplay);
                    const paid = paidByStudent.get(sid) || 0;
                    const due = Math.max(0, totalAfterConcession - paid);

                    (s as any).totalYearlyFee = totalAfterConcession;
                    (s as any).paidAmount = paid;
                    (s as any).dueAmount = due;
                }
            }

            // Final pass: force due/paid/total from canonical student summary
            // so class cards always match the detailed student fee page.
            if (studentsOut.length > 0) {
                const summaries = await Promise.all(
                    studentsOut.map((s: any) =>
                        FeeService.getStudentFeeSummary(req.schoolId!, String(s._id)).catch(() => null)
                    )
                );
                studentsOut = studentsOut.map((s: any, idx: number) => {
                    const summary: any = summaries[idx];
                    if (!summary) return s;
                    const due =
                        Number(summary?.dueAmount) ||
                        Number(summary?.student?.dueAmount) ||
                        Number(s?.dueAmount) ||
                        0;
                    const paid =
                        Number(summary?.paidAmount) ||
                        Number(summary?.student?.paidAmount) ||
                        Number(s?.paidAmount) ||
                        0;
                    const total =
                        Number(summary?.totalFeeAfterConcession) ||
                        Number(summary?.student?.totalYearlyFee) ||
                        Number(s?.totalYearlyFee) ||
                        0;
                    return {
                        ...s,
                        totalYearlyFee: total,
                        paidAmount: paid,
                        dueAmount: due,
                    };
                });
            }
            res.setHeader('X-Total-Count', String(total));
            res.setHeader('X-Page', String(page));
            res.setHeader('X-Limit', String(limit));
            return sendResponse(res, studentsOut, 'Class students retrieved', 200);
        } catch (error) {
            return next(error);
        }
    }
}

export default new ClassController();
