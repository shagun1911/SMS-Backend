import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import SalaryService from '../services/salary.service';
import { sendResponse } from '../utils/response';

class SalaryStructureController {
    async getByStaff(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const { staffId } = req.params;
            const structure = await SalaryService.getSalaryStructure(req.schoolId!, staffId);
            sendResponse(res, structure, 'Salary structure fetched', 200);
        } catch (error) {
            next(error);
        }
    }

    async upsertForStaff(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const { staffId } = req.params;
            const structure = await SalaryService.upsertSalaryStructure(req.schoolId!, staffId, req.body);
            sendResponse(res, structure, 'Salary structure saved', 200);
        } catch (error) {
            next(error);
        }
    }
}

export default new SalaryStructureController();

