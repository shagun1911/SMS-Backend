import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import Class from '../models/class.model';
import { sendResponse } from '../utils/response';
import { getTenantFilter } from '../utils/tenant';
import ErrorResponse from '../utils/errorResponse';

class ClassController {
    async getClasses(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const filter = getTenantFilter(req.schoolId!);
            const classes = await Class.find(filter)
                .populate('classTeacherId', 'name')
                .sort({ className: 1 });
            return sendResponse(res, classes, 'Classes retrieved', 200);
        } catch (error) {
            return next(error);
        }
    }

    async createClass(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const cls = await Class.create({
                ...req.body,
                schoolId: req.schoolId,
            });
            return sendResponse(res, cls, 'Class created', 201);
        } catch (error) {
            return next(error);
        }
    }

    async updateClass(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const cls = await Class.findOne({ _id: req.params.id, schoolId: req.schoolId });
            if (!cls) {
                return next(new ErrorResponse('Class not found', 404));
            }
            const updated = await Class.findByIdAndUpdate(req.params.id, req.body, { new: true });
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
            const { section } = req.query;
            const filter: any = { schoolId: req.schoolId, class: cls.className, isActive: true };
            if (section && typeof section === 'string') filter.section = section;
            const students = await Student.find(filter).sort({ rollNumber: 1, firstName: 1 });
            return sendResponse(res, students, 'Class students retrieved', 200);
        } catch (error) {
            return next(error);
        }
    }
}

export default new ClassController();
