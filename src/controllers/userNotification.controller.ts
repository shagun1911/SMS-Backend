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

            const page = parseInt(req.query.page as string, 10) || 1;
            const limit = Math.min(parseInt(req.query.limit as string, 10) || 50, 200);
            const safePage = Math.max(1, page);
            const skip = (safePage - 1) * limit;
            const [notifications, total] = await Promise.all([
                UserNotification.find(query)
                    .select('title message type isRead createdAt metadata')
                    .sort({ createdAt: -1 })
                    .skip(skip)
                    .limit(limit)
                    .lean(),
                UserNotification.countDocuments(query),
            ]);
            res.setHeader('X-Total-Count', String(total));
            res.setHeader('X-Page', String(safePage));
            res.setHeader('X-Limit', String(limit));

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

    /** PATCH /api/v1/user-notifications/sync-seen */
    async syncSeen(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const userId = req.user?._id;
            if (!userId) throw new ErrorResponse('Not authenticated', 401);

            const { seenIds } = req.body;
            if (!Array.isArray(seenIds)) {
                throw new ErrorResponse('seenIds array required', 400);
            }

            // Use $addToSet to merge unique IDs into the persistent list on the User document
            await (req.user as any).constructor.updateOne(
                { _id: userId },
                { $addToSet: { seenNotificationIds: { $each: seenIds } } }
            );

            res.status(200).json({ success: true });
        } catch (error) {
            next(error);
        }
    }
}

export default new UserNotificationController();
