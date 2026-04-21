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
            const page = parseInt(req.query.page as string, 10) || 1;
            const limit = Math.min(parseInt(req.query.limit as string, 10) || 50, 200);
            const safePage = Math.max(1, page);
            const skip = (safePage - 1) * limit;
            const query = { studentId: student._id };
            const [items, total] = await Promise.all([
                StudentNotification.find(query)
                    .select('title message type isRead createdAt metadata')
                    .sort({ createdAt: -1 })
                    .skip(skip)
                    .limit(limit)
                    .lean(),
                StudentNotification.countDocuments(query),
            ]);
            res.setHeader('X-Total-Count', String(total));
            res.setHeader('X-Page', String(safePage));
            res.setHeader('X-Limit', String(limit));
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
