import { NextFunction, Response } from 'express';
import { AuthRequest } from '../types';
import SalaryService from '../services/salary.service';
import { sendResponse } from '../utils/response';
import { cache } from '../utils/cache';
import { getSalaryGenerationQueue } from '../utils/queue';
import ErrorResponse from '../utils/errorResponse';

class SalaryController {
    /** GET /salaries?month=April&year=2025&status=pending&page=1&limit=100 – school-wide payroll list */
    async listSalaries(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const { month, year, status } = req.query;
            const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
            const limit = Math.min(parseInt(req.query.limit as string, 10) || 100, 500);
            const { items, total } = await SalaryService.listSchoolSalaries(req.schoolId!, {
                month: month as string | undefined,
                year: year ? Number(year) : undefined,
                status: status as string | undefined,
            }, { page, limit });
            res.setHeader('X-Total-Count', String(total));
            res.setHeader('X-Page', String(page));
            res.setHeader('X-Limit', String(limit));
            sendResponse(res, items, 'Payroll list', 200);
        } catch (error) {
            next(error);
        }
    }

    /** GET /salaries/summary?month=April&year=2025 – payroll summary cards */
    async getSummary(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const { month, year } = req.query;
            const cacheKey = `salary:summary:${req.schoolId}:${month || 'all'}-${year || 'all'}`;
            const summary = await cache.getOrSet(cacheKey, 20_000, () =>
                SalaryService.getPayrollSummary(req.schoolId!, {
                    month: month as string | undefined,
                    year: year ? Number(year) : undefined,
                })
            );
            sendResponse(res, summary, 'Payroll summary', 200);
        } catch (error) {
            next(error);
        }
    }

    // GENERATE Monthly Salaries (offloaded to background queue with sync fallback)
    async generateSalaries(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const { month, year, specificStaffId } = req.body;
            const queue = getSalaryGenerationQueue();
            
            if (queue) {
                await queue.add('generateSalaries', {
                    schoolId: req.schoolId!,
                    month,
                    year: Number(year),
                    specificStaffId,
                });
                return void sendResponse(res, { status: 'queued', month, year }, `Salary generation for ${month}-${year} initiated in the background`, 202);
            }

            // Fallback: Process synchronously if Redis/Queue is unavailable
            const result = await SalaryService.generateMonthlySalaries(req.schoolId!, month, Number(year), specificStaffId);
            sendResponse(res, { 
                status: 'completed', 
                created: result.created, 
                updated: result.updated 
            }, `Salary generation for ${month}-${year} completed successfully (sync)`, 200);
        } catch (error) {
            next(error);
        }
    }

    // PROCESS Payment
    async processPayment(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const { salaryId } = req.params;
            const { amount, mode, transactionId, remarks } = req.body;

            const result = await SalaryService.processPayment(req.schoolId!, salaryId, {
                amount,
                mode,
                transactionId,
                remarks,
            });

            sendResponse(res, result, 'Salary paid', 200);
        } catch (error) {
            next(error);
        }
    }

    // UPDATE Salary Structure
    async updateSalary(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const result = await SalaryService.updateSalaryStructure(req.schoolId!, req.params.salaryId, req.body);
            sendResponse(res, result, 'Salary record updated', 200);
        } catch (error) {
            next(error);
        }
    }

    // GET Slip
    async getSalarySlip(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const slip = await SalaryService.getSalarySlip(req.schoolId!, req.params.salaryId);
            sendResponse(res, slip, 'Salary Slip Retrieved', 200);
        } catch (error) {
            next(error);
        }
    }

    // GET Staff Salary for Month
    async getStaffSalaryForMonth(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const { staffId, monthYear } = req.params;
            const record = await SalaryService.getSalaryByStaffAndMonth(req.schoolId!, staffId, monthYear);
            sendResponse(res, record, 'Staff Monthly Salary Record', 200);
        } catch (error) {
            next(error);
        }
    }

    // GET Staff Salary History
    async getStaffSalaryHistory(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const { staffId } = req.params;
            const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
            const limit = Math.min(parseInt(req.query.limit as string, 10) || 50, 200);
            const { items, total } = await SalaryService.getStaffSalaryHistory(req.schoolId!, staffId, { page, limit });
            res.setHeader('X-Total-Count', String(total));
            res.setHeader('X-Page', String(page));
            res.setHeader('X-Limit', String(limit));
            sendResponse(res, items, 'Staff Salary History Retrieved', 200);
        } catch (error) {
            next(error);
        }
    }

    // GET Logged-in teacher's Salary History
    async getMySalaryHistory(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const staffId = req.user?._id?.toString();
            if (!staffId) {
                return next(new Error('User context missing'));
            }
            const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
            const limit = Math.min(parseInt(req.query.limit as string, 10) || 50, 200);
            const { items, total } = await SalaryService.getStaffSalaryHistory(req.schoolId!, staffId, { page, limit });
            res.setHeader('X-Total-Count', String(total));
            res.setHeader('X-Page', String(page));
            res.setHeader('X-Limit', String(limit));
            sendResponse(res, items, 'My Salary History Retrieved', 200);
        } catch (error) {
            next(error);
        }
    }
}

export default new SalaryController();
