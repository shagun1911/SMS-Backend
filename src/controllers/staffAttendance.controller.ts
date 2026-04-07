import { Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import StaffAbsentDay from '../models/staffAbsentDay.model';
import StaffPresentDay from '../models/staffPresentDay.model';
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

/** Calendar YYYY-MM-DD (UTC) from account creation or explicit joining date — absence totals count from this day onward. */
function joinStartYmd(user: { joiningDate?: Date | null; createdAt?: Date | null }): string {
    const d =
        user.joiningDate != null
            ? new Date(user.joiningDate)
            : user.createdAt != null
              ? new Date(user.createdAt)
              : new Date(0);
    return d.toISOString().slice(0, 10);
}

/**
 * Attendance dates are calendar YYYY-MM-DD from the browser. Hosted APIs often run in UTC, so
 * "today" in IST can be ahead of the server's calendar day. Prefer `X-Client-Date` from the client;
 * otherwise allow up through UTC "tomorrow" so timezones ahead of UTC are not blocked.
 */
function assertNotFutureYmd(dateStr: string, req: AuthRequest): void {
    if (!DATE_RE.test(dateStr)) {
        throw new ErrorResponse('Invalid date format; use YYYY-MM-DD', 400);
    }

    const rawHeader = req.headers['x-client-date'];
    const header =
        typeof rawHeader === 'string'
            ? rawHeader.trim().split(',')[0].trim()
            : Array.isArray(rawHeader)
              ? String(rawHeader[0] ?? '').trim()
              : '';

    if (DATE_RE.test(header)) {
        if (dateStr > header) {
            throw new ErrorResponse('Cannot mark attendance for a future date', 400);
        }
        return;
    }

    const [y, m, d] = dateStr.split('-').map(Number);
    const inputUtc = Date.UTC(y, m - 1, d);
    const now = new Date();
    const utcTodayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const maxUtc = utcTodayStart + 24 * 60 * 60 * 1000;
    if (inputUtc > maxUtc) {
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
                .select('name role staffRoleTitle joiningDate createdAt')
                .sort({ name: 1 })
                .lean();

            const staffIds = users.map((u) => u._id);
            const fromYmdByStaff = new Map<string, string>(
                users.map((u) => [String(u._id), joinStartYmd(u)])
            );

            const absenceRows =
                staffIds.length === 0
                    ? []
                    : await StaffAbsentDay.find({
                          schoolId,
                          staffId: { $in: staffIds },
                      })
                          .select('staffId date')
                          .lean();

            const totalAbsencesByStaff = new Map<string, number>();
            for (const id of staffIds) {
                totalAbsencesByStaff.set(String(id), 0);
            }
            for (const row of absenceRows) {
                const sid = String(row.staffId);
                const fromYmd = fromYmdByStaff.get(sid);
                if (fromYmd == null || row.date < fromYmd) continue;
                totalAbsencesByStaff.set(sid, (totalAbsencesByStaff.get(sid) ?? 0) + 1);
            }

            const data = users.map((u) => ({
                _id: u._id,
                name: u.name,
                role: u.role,
                staffRoleTitle: u.staffRoleTitle,
                totalAbsences: totalAbsencesByStaff.get(String(u._id)) ?? 0,
            }));

            return res.status(200).json({ success: true, data });
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
            const [absentDocs, presentDocs] = await Promise.all([
                StaffAbsentDay.find({ schoolId, date }).select('staffId').lean(),
                StaffPresentDay.find({ schoolId, date }).select('staffId').lean(),
            ]);
            const absentStaffIds = absentDocs.map((d) => String(d.staffId));
            const presentStaffIds = presentDocs.map((d) => String(d.staffId));
            return res.status(200).json({
                success: true,
                data: { absentStaffIds, presentStaffIds },
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
                marks?: Record<string, 'PRESENT' | 'ABSENT' | 'PENDING'>;
            };

            if (!date || !DATE_RE.test(date)) {
                return next(new ErrorResponse('date (YYYY-MM-DD) is required', 400));
            }
            assertNotFutureYmd(date, req);
            if (!marks || typeof marks !== 'object' || Array.isArray(marks)) {
                return next(new ErrorResponse('marks object is required', 400));
            }

            const eligible = await User.find({
                schoolId,
                role: { $nin: EXCLUDED_ROLES },
                isActive: { $ne: false },
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
                if (status !== 'PRESENT' && status !== 'ABSENT' && status !== 'PENDING') {
                    return next(
                        new ErrorResponse('Each mark must be PRESENT, ABSENT, or PENDING', 400)
                    );
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
                            await StaffPresentDay.deleteOne(
                                { schoolId: schoolOid, staffId: staffOid, date },
                                { session }
                            );
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
                        } else if (status === 'PRESENT') {
                            await StaffAbsentDay.deleteOne(
                                { schoolId: schoolOid, staffId: staffOid, date },
                                { session }
                            );
                            await StaffPresentDay.findOneAndUpdate(
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
                            await StaffPresentDay.deleteOne(
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

    /**
     * End-of-day: everyone with an explicit present mark for this date stays present (stored as no absent row);
     * everyone else is recorded absent. Clears StaffPresentDay rows for the date after processing.
     */
    async finalizeDay(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const schoolId = req.schoolId!;
            const adminId = req.user!._id;
            const { date } = req.body as { date?: string };

            if (!date || !DATE_RE.test(date)) {
                return next(new ErrorResponse('date (YYYY-MM-DD) is required', 400));
            }
            assertNotFutureYmd(date, req);

            const eligible = await User.find({
                schoolId,
                role: { $nin: EXCLUDED_ROLES },
                isActive: { $ne: false },
            })
                .select('_id')
                .lean();

            const schoolOid = new mongoose.Types.ObjectId(schoolId);
            let presentCount = 0;
            let absentCount = 0;

            const session = await mongoose.startSession();
            try {
                await session.withTransaction(async () => {
                    for (const u of eligible) {
                        const staffOid = u._id as mongoose.Types.ObjectId;
                        const hasPresent = await StaffPresentDay.findOne({
                            schoolId: schoolOid,
                            staffId: staffOid,
                            date,
                        })
                            .select('_id')
                            .session(session)
                            .lean();

                        if (hasPresent) {
                            await StaffAbsentDay.deleteOne(
                                { schoolId: schoolOid, staffId: staffOid, date },
                                { session }
                            );
                            await StaffPresentDay.deleteOne(
                                { schoolId: schoolOid, staffId: staffOid, date },
                                { session }
                            );
                            presentCount += 1;
                        } else {
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
                            await StaffPresentDay.deleteOne(
                                { schoolId: schoolOid, staffId: staffOid, date },
                                { session }
                            );
                            absentCount += 1;
                        }
                    }
                });
            } finally {
                session.endSession();
            }

            return res.status(200).json({
                success: true,
                message: 'Staff attendance finalized for this date',
                data: { presentCount, absentCount },
            });
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
