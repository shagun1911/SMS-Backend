import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import School from '../models/school.model';
import SupportTicket from '../models/supportTicket.model';
import ErrorResponse from '../utils/errorResponse';
import { sendResponse } from '../utils/response';

export class SupportController {
    /** POST /support/tickets – school creates a ticket */
    async createTicket(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const user = req.user;
            if (!user?.schoolId) {
                return next(new ErrorResponse('School context required to create a ticket', 400));
            }
            const { subject, message, priority } = req.body;
            const school = await School.findById(user.schoolId).select('schoolName').lean();
            const schoolName = (school as any)?.schoolName ?? 'Unknown';
            const ticket = await SupportTicket.create({
                schoolId: user.schoolId,
                schoolName,
                subject: subject || 'No subject',
                message: message || '',
                priority: priority === 'low' || priority === 'high' ? priority : 'medium',
            });
            return sendResponse(res, ticket, 'Ticket created', 201);
        } catch (error) {
            next(error);
        }
    }

    /** GET /support/tickets – school sees own tickets only */
    async getMyTickets(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const user = req.user;
            if (!user?.schoolId) {
                return next(new ErrorResponse('School context required', 400));
            }
            const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
            const limit = Math.min(parseInt(req.query.limit as string, 10) || 20, 100);
            const skip = (page - 1) * limit;
            const filter = { schoolId: user.schoolId };
            const [tickets, total] = await Promise.all([
                SupportTicket.find(filter)
                    .select('subject message priority status schoolName createdAt updatedAt')
                    .sort({ createdAt: -1 })
                    .skip(skip)
                    .limit(limit)
                    .lean(),
                SupportTicket.countDocuments(filter),
            ]);
            res.setHeader('X-Total-Count', String(total));
            res.setHeader('X-Page', String(page));
            res.setHeader('X-Limit', String(limit));
            return sendResponse(res, tickets, 'OK', 200);
        } catch (error) {
            next(error);
        }
    }
}

export default new SupportController();
