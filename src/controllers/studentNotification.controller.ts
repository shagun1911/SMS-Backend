import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import StudentNotification from '../models/studentNotification.model';
import ErrorResponse from '../utils/errorResponse';

class StudentNotificationController {
    async listMine(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const student = req.student;
            if (!student?._id) {
                return next(new ErrorResponse('Not authenticated', 401));
            }
            const items = await StudentNotification.find({ studentId: student._id })
                .sort({ createdAt: -1 })
                .limit(50)
                .lean();
            res.status(200).json({ success: true, data: items });
        } catch (error) {
            next(error);
        }
    }

    async markRead(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const student = req.student;
            if (!student?._id) return next(new ErrorResponse('Not authenticated', 401));

            const updated = await StudentNotification.findOneAndUpdate(
                { _id: req.params.id, studentId: student._id },
                { isRead: true },
                { new: true }
            );
            if (!updated) return next(new ErrorResponse('Notification not found', 404));
            res.status(200).json({ success: true, data: updated });
        } catch (error) {
            next(error);
        }
    }

    async markAllRead(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const student = req.student;
            if (!student?._id) return next(new ErrorResponse('Not authenticated', 401));

            await StudentNotification.updateMany(
                { studentId: student._id, isRead: false },
                { isRead: true }
            );
            res.status(200).json({ success: true, data: {} });
        } catch (error) {
            next(error);
        }
    }
}

export default new StudentNotificationController();
