import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import Session from '../models/session.model';
import { sendResponse } from '../utils/response';
import { getTenantFilter } from '../utils/tenant';

class SessionController {
    async getSessions(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const filter = getTenantFilter(req.schoolId!);
            const page = parseInt(req.query.page as string, 10) || 1;
            const limit = Math.min(parseInt(req.query.limit as string, 10) || 100, 300);
            const safePage = Math.max(1, page);
            const skip = (safePage - 1) * limit;
            const [sessions, total] = await Promise.all([
                Session.find(filter)
                    .select('sessionYear startDate endDate isActive promotionCompleted promotionDate createdAt updatedAt')
                    .sort({ startDate: -1 })
                    .skip(skip)
                    .limit(limit)
                    .lean(),
                Session.countDocuments(filter),
            ]);
            res.setHeader('X-Total-Count', String(total));
            res.setHeader('X-Page', String(safePage));
            res.setHeader('X-Limit', String(limit));
            return sendResponse(res, sessions, 'Sessions retrieved', 200);
        } catch (error) {
            return next(error);
        }
    }

    async createSession(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const session = await Session.create({
                ...req.body,
                schoolId: req.schoolId,
            });
            return sendResponse(res, session, 'Session created', 201);
        } catch (error) {
            return next(error);
        }
    }

    async updateSession(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const session = await Session.findOneAndUpdate(
                { _id: req.params.id, schoolId: req.schoolId },
                req.body,
                { new: true }
            );
            return sendResponse(res, session, 'Session updated', 200);
        } catch (error) {
            return next(error);
        }
    }
}

export default new SessionController();
