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
                .sort({ className: 1, section: 1 });
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
            const students = await Student.find(filter).sort({ rollNumber: 1, firstName: 1 });
            return sendResponse(res, students, 'Class students retrieved', 200);
        } catch (error) {
            return next(error);
        }
    }
}

export default new ClassController();
