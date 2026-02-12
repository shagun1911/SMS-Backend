import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import Timetable from '../models/timetable.model';
import { sendResponse } from '../utils/response';

class TimetableController {
    async getTimetables(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const { className, section } = req.query;
            const filter: any = { schoolId: req.schoolId, isActive: true };
            if (className) filter.className = className;
            if (section) filter.section = section;
            const timetables = await Timetable.find(filter)
                .populate('slots.teacherId', 'name')
                .sort({ dayOfWeek: 1 });
            return sendResponse(res, timetables, 'Timetables retrieved', 200);
        } catch (error) {
            return next(error);
        }
    }

    async upsertTimetable(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const { className, section, dayOfWeek, slots } = req.body;
            const existing = await Timetable.findOne({
                schoolId: req.schoolId,
                className,
                section: section || 'A',
                dayOfWeek: Number(dayOfWeek),
            });
            const payload = {
                schoolId: req.schoolId,
                className,
                section: section || 'A',
                dayOfWeek: Number(dayOfWeek),
                slots: slots || [],
                isActive: true,
            };
            let doc;
            if (existing) {
                doc = await Timetable.findByIdAndUpdate(existing._id, payload, { new: true })
                    .populate('slots.teacherId', 'name');
            } else {
                doc = await Timetable.create(payload);
            }
            return sendResponse(res, doc, 'Timetable saved', 200);
        } catch (error) {
            return next(error);
        }
    }
}

export default new TimetableController();
