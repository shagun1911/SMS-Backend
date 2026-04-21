import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import SalaryService from '../services/salary.service';
import { sendResponse } from '../utils/response';

class OtherPaymentController {
    /** GET /salary-other-payments/me — logged-in staff (teacher, etc.) sees own bonuses/adjustments */
    async listMine(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const staffId = req.user!._id.toString();
            const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
            const limit = Math.min(parseInt(req.query.limit as string, 10) || 50, 200);
            const { items, total } = await SalaryService.listOtherPayments(req.schoolId!, staffId, { page, limit });
            res.setHeader('X-Total-Count', String(total));
            res.setHeader('X-Page', String(page));
            res.setHeader('X-Limit', String(limit));
            sendResponse(res, items, 'Other payments fetched', 200);
        } catch (error) {
            next(error);
        }
    }

    async listForStaff(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const { staffId } = req.params;
            const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
            const limit = Math.min(parseInt(req.query.limit as string, 10) || 50, 200);
            const { items, total } = await SalaryService.listOtherPayments(req.schoolId!, staffId, { page, limit });
            res.setHeader('X-Total-Count', String(total));
            res.setHeader('X-Page', String(page));
            res.setHeader('X-Limit', String(limit));
            sendResponse(res, items, 'Other payments fetched', 200);
        } catch (error) {
            next(error);
        }
    }

    async createForStaff(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const { staffId } = req.params;
            const payload = req.body;

            const record = await SalaryService.createOtherPayment(req.schoolId!, staffId, {
                title: payload.title,
                amount: payload.amount,
                type: payload.type,
                date: new Date(payload.date),
                notes: payload.notes,
            });

            sendResponse(res, record, 'Other payment created', 201);
        } catch (error) {
            next(error);
        }
    }
}

export default new OtherPaymentController();

