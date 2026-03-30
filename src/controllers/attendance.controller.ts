import { Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import AttendanceDay from '../models/attendanceDay.model';
import Class from '../models/class.model';
import Student from '../models/student.model';
import { AuthRequest } from '../types';
import { sendResponse } from '../utils/response';
import ErrorResponse from '../utils/errorResponse';
import { scheduleAbsentStudentNotifications } from '../services/attendanceNotify.service';

function normalizeYmd(raw: unknown): string | null {
    if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) return null;
    return raw.trim();
}

class AttendanceController {
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
