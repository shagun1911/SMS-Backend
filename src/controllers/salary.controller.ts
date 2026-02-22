import { NextFunction, Response } from 'express';
import { AuthRequest } from '../types';
import SalaryService from '../services/salary.service';
import { sendResponse } from '../utils/response';

class SalaryController {
    /** GET /salaries?month=April&year=2025&status=pending – school-wide payroll list */
    async listSalaries(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const { month, year, status } = req.query;
            const records = await SalaryService.listSchoolSalaries(req.schoolId!, {
                month: month as string | undefined,
                year: year ? Number(year) : undefined,
                status: status as string | undefined,
            });
            sendResponse(res, records, 'Payroll list', 200);
        } catch (error) {
            next(error);
        }
    }

    /** GET /salaries/summary?month=April&year=2025 – payroll summary cards */
    async getSummary(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const { month, year } = req.query;
            const summary = await SalaryService.getPayrollSummary(req.schoolId!, {
                month: month as string | undefined,
                year: year ? Number(year) : undefined,
            });
            sendResponse(res, summary, 'Payroll summary', 200);
        } catch (error) {
            next(error);
        }
    }

    // GENERATE Monthly Salaries
    async generateSalaries(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const { month, year, specificStaffId } = req.body;
            const result = await SalaryService.generateMonthlySalaries(req.schoolId!, month, year, specificStaffId);
            sendResponse(res, result, `Generated salaries for ${month}-${year}`, 201);
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
            const records = await SalaryService.getStaffSalaryHistory(req.schoolId!, staffId);
            sendResponse(res, records, 'Staff Salary History Retrieved', 200);
        } catch (error) {
            next(error);
        }
    }
}

export default new SalaryController();
