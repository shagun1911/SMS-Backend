import { Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import StaffAbsentDay from '../models/staffAbsentDay.model';
import User from '../models/user.model';
import ErrorResponse from '../utils/errorResponse';
import { AuthRequest, UserRole } from '../types';

const EXCLUDED_ROLES: UserRole[] = [
    UserRole.SCHOOL_ADMIN,
    UserRole.BUS_DRIVER,
    UserRole.CONDUCTOR,
];

const EXCLUDED_SET = new Set(EXCLUDED_ROLES);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function assertNotFutureYmd(dateStr: string): void {
    if (!DATE_RE.test(dateStr)) {
        throw new ErrorResponse('Invalid date format; use YYYY-MM-DD', 400);
    }
    const [y, m, d] = dateStr.split('-').map(Number);
    const input = new Date(y, m - 1, d);
    const today = new Date();
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    if (input > todayStart) {
        throw new ErrorResponse('Cannot mark attendance for a future date', 400);
    }
}

function monthBounds(year: number, month: number): { start: string; end: string } {
    if (month < 1 || month > 12 || year < 2000 || year > 2100) {
        throw new ErrorResponse('Invalid year or month', 400);
    }
    const mm = String(month).padStart(2, '0');
    const start = `${year}-${mm}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const end = `${year}-${mm}-${String(lastDay).padStart(2, '0')}`;
    return { start, end };
}

class StaffAttendanceController {
    async getEligible(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const schoolId = req.schoolId!;
            const users = await User.find({
                schoolId,
                role: { $nin: EXCLUDED_ROLES },
                isActive: { $ne: false },
            })
                .select('name role staffRoleTitle')
                .sort({ name: 1 })
                .lean();

            return res.status(200).json({ success: true, data: users });
        } catch (e) {
            return next(e);
        }
    }

    async getDayAbsences(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const schoolId = req.schoolId!;
            const date = String(req.query.date || '');
            if (!DATE_RE.test(date)) {
                return next(new ErrorResponse('Query ?date=YYYY-MM-DD is required', 400));
            }
            const docs = await StaffAbsentDay.find({ schoolId, date })
                .select('staffId')
                .lean();
            const absentStaffIds = docs.map((d) => String(d.staffId));
            return res.status(200).json({
                success: true,
                data: { absentStaffIds },
            });
        } catch (e) {
            return next(e);
        }
    }

    async saveDay(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const schoolId = req.schoolId!;
            const adminId = req.user!._id;
            const { date, marks } = req.body as {
                date?: string;
                marks?: Record<string, 'PRESENT' | 'ABSENT'>;
            };

            if (!date || !DATE_RE.test(date)) {
                return next(new ErrorResponse('date (YYYY-MM-DD) is required', 400));
            }
            assertNotFutureYmd(date);
            if (!marks || typeof marks !== 'object' || Array.isArray(marks)) {
                return next(new ErrorResponse('marks object is required', 400));
            }

            const eligible = await User.find({
                schoolId,
                role: { $nin: EXCLUDED_ROLES },
            })
                .select('_id')
                .lean();
            const allowed = new Set(eligible.map((u) => String(u._id)));

            for (const [staffIdRaw, status] of Object.entries(marks)) {
                if (!allowed.has(staffIdRaw)) {
                    return next(
                        new ErrorResponse(
                            `Staff is not in the attendance list (wrong role or not in school)`,
                            400
                        )
                    );
                }
                if (status !== 'PRESENT' && status !== 'ABSENT') {
                    return next(new ErrorResponse('Each mark must be PRESENT or ABSENT', 400));
                }
            }

            for (const id of allowed) {
                if (!Object.prototype.hasOwnProperty.call(marks, id)) {
                    return next(
                        new ErrorResponse('marks must include every staff member in the attendance list', 400)
                    );
                }
            }

            const schoolOid = new mongoose.Types.ObjectId(schoolId);
            const session = await mongoose.startSession();
            try {
                await session.withTransaction(async () => {
                    for (const [staffIdRaw, status] of Object.entries(marks)) {
                        const staffOid = new mongoose.Types.ObjectId(staffIdRaw);
                        if (status === 'ABSENT') {
                            await StaffAbsentDay.findOneAndUpdate(
                                { schoolId: schoolOid, staffId: staffOid, date },
                                {
                                    $set: {
                                        schoolId: schoolOid,
                                        staffId: staffOid,
                                        date,
                                        markedBy: adminId,
                                    },
                                },
                                { upsert: true, new: true, session }
                            );
                        } else {
                            await StaffAbsentDay.deleteOne(
                                { schoolId: schoolOid, staffId: staffOid, date },
                                { session }
                            );
                        }
                    }
                });
            } finally {
                session.endSession();
            }

            return res.status(200).json({ success: true, message: 'Attendance saved' });
        } catch (e) {
            return next(e);
        }
    }

    async getStaffMonth(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const schoolId = req.schoolId!;
            const staffId = req.params.staffId;
            const year = Number(req.query.year);
            const month = Number(req.query.month);
            if (!Number.isFinite(year) || !Number.isFinite(month)) {
                return next(new ErrorResponse('year and month query params are required', 400));
            }
            const { start, end } = monthBounds(year, month);

            const staff = await User.findOne({ _id: staffId, schoolId })
                .select('role')
                .lean();
            if (!staff) {
                return next(new ErrorResponse('Staff not found', 404));
            }
            if (EXCLUDED_SET.has(staff.role as UserRole)) {
                return res.status(200).json({
                    success: true,
                    data: {
                        absences: [] as { date: string; status: 'ABSENT' }[],
                        totalAbsents: 0,
                        notTracked: true,
                    },
                });
            }

            const docs = await StaffAbsentDay.find({
                schoolId,
                staffId,
                date: { $gte: start, $lte: end },
            })
                .select('date')
                .sort({ date: 1 })
                .lean();

            const absences = docs.map((d) => ({ date: d.date, status: 'ABSENT' as const }));
            return res.status(200).json({
                success: true,
                data: {
                    absences,
                    totalAbsents: absences.length,
                    notTracked: false,
                },
            });
        } catch (e) {
            return next(e);
        }
    }
}

export default new StaffAttendanceController();
