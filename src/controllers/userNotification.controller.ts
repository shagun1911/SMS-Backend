import { NextFunction, Response } from 'express';
import { AuthRequest } from '../types';
import UserNotification from '../models/userNotification.model';
import ErrorResponse from '../utils/errorResponse';

class UserNotificationController {
    /** GET /api/v1/user-notifications */
    async getMyNotifications(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const userId = req.user?._id;
            if (!userId) {
                throw new ErrorResponse('User not authenticated', 401);
            }

            const query: any = { userId };
            if (req.user?.schoolId) {
                query.schoolId = req.user.schoolId;
            }

            const typeQ = typeof req.query.type === 'string' ? req.query.type.trim() : '';
            if (typeQ) {
                query.type = typeQ;
            }

            const notifications = await UserNotification.find(query)
                .sort({ createdAt: -1 })
                .limit(50);

            res.status(200).json({ success: true, data: notifications });
        } catch (error) {
            next(error);
        }
    }

    /** PATCH /api/v1/user-notifications/:id/read */
    async markAsRead(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const userId = req.user?._id;
            if (!userId) throw new ErrorResponse('Not authenticated', 401);

            const notification = await UserNotification.findOneAndUpdate(
                { _id: req.params.id, userId },
                { isRead: true },
                { new: true }
            );

            if (!notification) {
                throw new ErrorResponse('Notification not found or unauthorized', 404);
            }

            res.status(200).json({ success: true, data: notification });
        } catch (error) {
            next(error);
        }
    }

    /** PATCH /api/v1/user-notifications/read-all */
    async markAllAsRead(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const userId = req.user?._id;
            if (!userId) throw new ErrorResponse('Not authenticated', 401);

            const query: any = { userId, isRead: false };
            if (req.user?.schoolId) {
                query.schoolId = req.user.schoolId;
            }

            const typeQ = typeof req.query.type === 'string' ? req.query.type.trim() : '';
            if (typeQ) {
                query.type = typeQ;
            }

            await UserNotification.updateMany(query, { isRead: true });

            res.status(200).json({ success: true, data: {} });
        } catch (error) {
            next(error);
        }
    }
}

export default new UserNotificationController();
