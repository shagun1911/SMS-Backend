import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import Session from '../models/session.model';
import { sendResponse } from '../utils/response';
import { getTenantFilter } from '../utils/tenant';

class SessionController {
    async getSessions(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const filter = getTenantFilter(req.schoolId!);
            const sessions = await Session.find(filter).sort({ startDate: -1 });
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
