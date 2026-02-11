import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import Attendance from '../models/attendance.model';
import { getTenantFilter } from '../utils/tenant';
import { sendResponse } from '../utils/response';

class AttendanceController {
    /**
     * Get Attendance with filters
     */
    async getAttendance(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const { date } = req.query;
            const filter = getTenantFilter(req.schoolId!, {
                ...(date && { date: new Date(date as string) }),
                ...(req.query.class && { class: req.query.class })
            });

            const attendance = await Attendance.find(filter)
                .populate('studentId', 'firstName lastName admissionNumber')
                .populate('takenBy', 'name');

            sendResponse(res, attendance, 'Attendance retrieved', 200);
        } catch (error) {
            next(error);
        }
    }

    /**
     * Bulk Mark Attendance
     */
    async markAttendance(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const { records, date } = req.body; // records: [{ studentId, status, remarks }]

            const attendanceDate = new Date(date);

            const operations = records.map((rec: any) => ({
                updateOne: {
                    filter: {
                        schoolId: req.schoolId,
                        studentId: rec.studentId,
                        date: attendanceDate
                    },
                    update: {
                        status: rec.status,
                        remarks: rec.remarks,
                        takenBy: req.user!._id,
                        schoolId: req.schoolId,
                        studentId: rec.studentId,
                        date: attendanceDate
                    },
                    upsert: true
                }
            }));

            await Attendance.bulkWrite(operations);
            sendResponse(res, {}, 'Attendance marked successfully', 200);
        } catch (error) {
            next(error);
        }
    }
}

export default new AttendanceController();
