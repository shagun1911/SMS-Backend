import { Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import AttendanceDay from '../models/attendanceDay.model';
import Class from '../models/class.model';
import Student from '../models/student.model';
import StaffAbsentDay from '../models/staffAbsentDay.model';
import StaffPresentDay from '../models/staffPresentDay.model';
import { AuthRequest, UserRole } from '../types';
import { sendResponse } from '../utils/response';
import ErrorResponse from '../utils/errorResponse';
import { scheduleAbsentStudentNotifications } from '../services/attendanceNotify.service';

function normalizeYmd(raw: unknown): string | null {
    if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) return null;
    return raw.trim();
}

class AttendanceController {
    /**
     * GET /attendance/me?year=&month=
     * Read-only staff attendance for teacher/accountant/transport_manager/cleaning/staff_other.
     */
    async getMyAttendance(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const me = req.user;
            if (!me || !req.schoolId) return next(new ErrorResponse('Not authorized', 401));
            const allowed = new Set<UserRole>([
                UserRole.TEACHER,
                UserRole.ACCOUNTANT,
                UserRole.TRANSPORT_MANAGER,
                UserRole.CLEANING_STAFF,
                UserRole.STAFF_OTHER,
            ]);
            const role = me.role as UserRole;
            if (!allowed.has(role)) {
                return next(new ErrorResponse('Attendance view is not available for this role', 403));
            }

            const yearQ = Number(req.query.year);
            const monthQ = Number(req.query.month);
            let year = yearQ;
            let month = monthQ;
            if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
                const parts = new Intl.DateTimeFormat('en-CA', {
                    timeZone: 'Asia/Kolkata',
                    year: 'numeric',
                    month: '2-digit',
                })
                    .formatToParts(new Date())
                    .reduce<Record<string, string>>((acc, p) => {
                        if (p.type === 'year' || p.type === 'month') acc[p.type] = p.value;
                        return acc;
                    }, {});
                year = Number(parts.year);
                month = Number(parts.month);
            }
            const mm = String(month).padStart(2, '0');
            const start = `${year}-${mm}-01`;
            const end = `${year}-${mm}-${String(new Date(year, month, 0).getDate()).padStart(2, '0')}`;

            const schoolId = req.schoolId!;
            const userId = String(me._id);

            const [absentDocs, presentDocs, totalAbsents] = await Promise.all([
                StaffAbsentDay.find({ schoolId, staffId: userId, date: { $gte: start, $lte: end } })
                    .select('date')
                    .sort({ date: 1 })
                    .lean(),
                StaffPresentDay.find({ schoolId, staffId: userId, date: { $gte: start, $lte: end } })
                    .select('date')
                    .sort({ date: 1 })
                    .lean(),
                StaffAbsentDay.countDocuments({ schoolId, staffId: userId }),
            ]);

            const byDate = new Map<string, { date: string; status: 'present' | 'absent' }>();
            for (const d of presentDocs) byDate.set(d.date, { date: d.date, status: 'present' });
            for (const d of absentDocs) byDate.set(d.date, { date: d.date, status: 'absent' });
            const attendance = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
            const totalAbsentsThisMonth = absentDocs.length;

            return sendResponse(
                res,
                {
                    year,
                    month,
                    attendance,
                    totalAbsents,
                    totalAbsentsThisMonth,
                },
                'My attendance',
                200
            );
        } catch (error) {
            next(error);
        }
    }

    /**
     * GET /attendance/day?classId=&date= — whether this class/date already has a record.
     */
    async getDayStatus(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const classId = req.query.classId as string;
            const date = normalizeYmd(req.query.date);
            if (!classId || !mongoose.isValidObjectId(classId) || !date) {
                return next(new ErrorResponse('classId and date (YYYY-MM-DD) are required', 400));
            }
            const doc = await AttendanceDay.findOne({
                schoolId: req.schoolId,
                classId,
                date,
            })
                .select('absentStudentIds date updatedAt')
                .lean();

            if (!doc) {
                return sendResponse(res, { submitted: false, absentStudentIds: [] }, 'No attendance yet', 200);
            }
            return sendResponse(
                res,
                {
                    submitted: true,
                    absentStudentIds: (doc.absentStudentIds || []).map((id) => String(id)),
                    date: doc.date,
                    updatedAt: doc.updatedAt,
                },
                'Attendance status',
                200
            );
        } catch (error) {
            next(error);
        }
    }

    /**
     * POST /attendance — submit one record per class per day; only absent IDs stored.
     */
    async submit(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const classId = req.body.classId as string;
            let date = normalizeYmd(req.body.date);
            if (!date) {
                const d = new Date();
                date = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
            }

            if (!classId || !mongoose.isValidObjectId(classId)) {
                return next(new ErrorResponse('Valid classId is required', 400));
            }

            const cls = await Class.findOne({ _id: classId, schoolId: req.schoolId, isActive: true });
            if (!cls) {
                return next(new ErrorResponse('Class not found', 404));
            }

            const section = cls.section;
            const className = cls.className;

            const rawAbsent: unknown[] = Array.isArray(req.body.absentStudentIds) ? req.body.absentStudentIds : [];
            const absentIds = rawAbsent
                .map((id) => String(id))
                .filter((id) => mongoose.isValidObjectId(id));

            const uniqueAbsent = [...new Set(absentIds)];

            if (uniqueAbsent.length) {
                const count = await Student.countDocuments({
                    schoolId: req.schoolId,
                    class: className,
                    section,
                    isActive: true,
                    _id: { $in: uniqueAbsent.map((id) => new mongoose.Types.ObjectId(id)) },
                });
                if (count !== uniqueAbsent.length) {
                    return next(
                        new ErrorResponse('One or more students are not in this class or inactive', 400)
                    );
                }
            }

            const dup = await AttendanceDay.findOne({
                schoolId: req.schoolId,
                classId,
                date,
            }).select('_id');
            if (dup) {
                return next(
                    new ErrorResponse('Attendance for this class and date has already been submitted', 409)
                );
            }

            const absentOids = uniqueAbsent.map((id) => new mongoose.Types.ObjectId(id));

            const record = await AttendanceDay.create({
                schoolId: req.schoolId,
                classId,
                date,
                absentStudentIds: absentOids,
                markedBy: req.user?._id,
            });

            scheduleAbsentStudentNotifications(req.schoolId!, absentOids, date);

            return sendResponse(res, record, 'Attendance saved', 201);
        } catch (error: any) {
            if (error?.code === 11000) {
                return next(
                    new ErrorResponse('Attendance for this class and date has already been submitted', 409)
                );
            }
            next(error);
        }
    }
}

export default new AttendanceController();
