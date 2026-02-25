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
            const tickets = await SupportTicket.find({ schoolId: user.schoolId }).sort({ createdAt: -1 }).lean();
            return sendResponse(res, tickets, 'OK', 200);
        } catch (error) {
            next(error);
        }
    }
}

export default new SupportController();
