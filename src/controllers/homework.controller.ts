import { Response, NextFunction } from 'express';
import Homework from '../models/homework.model';
import { AuthRequest } from '../types';
import { sendResponse } from '../utils/response';
import ErrorResponse from '../utils/errorResponse';

class HomeworkController {
    /** POST /homework — teacher/admin creates homework */
    async create(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const { className, section, subject, title, description, dueDate, attachmentUrl } = req.body;
            if (!className || !section || !subject || !title || !description || !dueDate) {
                return next(new ErrorResponse('className, section, subject, title, description, dueDate are required', 400));
            }
            const homework = await Homework.create({
                schoolId: req.schoolId,
                className,
                section: section.toString().toUpperCase(),
                subject,
                title,
                description,
                dueDate: new Date(dueDate),
                createdBy: req.user!._id,
                attachmentUrl,
            });
            return sendResponse(res, homework, 'Homework created', 201);
        } catch (error) {
            next(error);
        }
    }

    /** GET /homework?class=&section= — teacher/admin lists homework */
    async list(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const filter: any = { schoolId: req.schoolId, isActive: true };
            if (req.query.class) filter.className = req.query.class;
            if (req.query.section) filter.section = (req.query.section as string).toUpperCase();
            const homework = await Homework.find(filter)
                .populate('createdBy', 'name')
                .sort({ dueDate: 1 })
                .lean();
            return sendResponse(res, homework, 'Homework list', 200);
        } catch (error) {
            next(error);
        }
    }

    /** GET /homework/student — student sees homework for their class+section (uses protectStudent) */
    async listForStudent(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const student = req.student!;
            const homework = await Homework.find({
                schoolId: student.schoolId,
                className: student.class,
                section: student.section,
                isActive: true,
            })
                .populate('createdBy', 'name')
                .sort({ dueDate: 1 })
                .lean();
            return sendResponse(res, homework, 'Homework for student', 200);
        } catch (error) {
            next(error);
        }
    }

    /** DELETE /homework/:id */
    async remove(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const hw = await Homework.findOne({ _id: req.params.id, schoolId: req.schoolId });
            if (!hw) return next(new ErrorResponse('Homework not found', 404));
            hw.isActive = false;
            await hw.save();
            return sendResponse(res, {}, 'Homework deleted', 200);
        } catch (error) {
            next(error);
        }
    }
}

export default new HomeworkController();
