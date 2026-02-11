import { NextFunction, Response } from 'express';
import { AuthRequest } from '../types';
import FeeService from '../services/fee.service';
import { sendResponse } from '../utils/response';

class FeeController {
    // CREATE Fee Structure
    async createFeeStructure(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const data = await FeeService.createFeeStructure(req.schoolId!, req.body);
            sendResponse(res, data, 'Fee structure created', 201);
        } catch (error) {
            next(error);
        }
    }

    // GENERATE Monthly Fees
    async generateFees(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const { className, month, dueDate } = req.body;
            const result = await FeeService.generateMonthlyFees(
                req.schoolId!,
                className,
                month,
                new Date(dueDate)
            );
            sendResponse(res, result, `Generated fees for ${month}`, 201);
        } catch (error) {
            next(error);
        }
    }

    // RECORD Payment
    async recordPayment(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const { feeId } = req.params;
            const { amount, mode, transactionId, remarks } = req.body;

            const result = await FeeService.recordPayment(req.schoolId!, feeId, {
                amount: Number(amount),
                mode,
                transactionId,
                remarks,
                staffId: req.user!._id.toString(),
            });

            sendResponse(res, result, 'Payment recorded', 200);
        } catch (error) {
            next(error);
        }
    }

    // GET Ledger
    async getStudentLedger(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const ledger = await FeeService.getStudentLedger(req.schoolId!, req.params.studentId);
            sendResponse(res, ledger, 'Student Ledger Retrieved', 200);
        } catch (error) {
            next(error);
        }
    }

    // GET Collection Report
    async getCollectionReport(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const report = await FeeService.getCollectionReport(req.schoolId!, req.query.month as string);
            sendResponse(res, report, 'Collection Report', 200);
        } catch (error) {
            next(error);
        }
    }

    // LIST All Fees
    async listFees(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const fees = await FeeService.listAllFees(req.schoolId!, req.query);
            sendResponse(res, fees, 'Fees retrieved', 200);
        } catch (error) {
            next(error);
        }
    }
}

export default new FeeController();
