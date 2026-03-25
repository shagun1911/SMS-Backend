import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import SalaryService from '../services/salary.service';
import { sendResponse } from '../utils/response';

class OtherPaymentController {
    /** GET /salary-other-payments/me — logged-in staff (teacher, etc.) sees own bonuses/adjustments */
    async listMine(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const staffId = req.user!._id.toString();
            const records = await SalaryService.listOtherPayments(req.schoolId!, staffId);
            sendResponse(res, records, 'Other payments fetched', 200);
        } catch (error) {
            next(error);
        }
    }

    async listForStaff(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const { staffId } = req.params;
            const records = await SalaryService.listOtherPayments(req.schoolId!, staffId);
            sendResponse(res, records, 'Other payments fetched', 200);
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

