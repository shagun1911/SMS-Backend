import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import Exam from '../models/exam.model';
import { getTenantFilter } from '../utils/tenant';
import { sendResponse } from '../utils/response';

class ExamController {
    async getExams(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const filter = getTenantFilter(req.schoolId!);
            const exams = await Exam.find(filter).sort({ startDate: 1 });
            sendResponse(res, exams, 'Exams retrieved', 200);
        } catch (error) {
            next(error);
        }
    }

    async createExam(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const exam = await Exam.create({
                ...req.body,
                schoolId: req.schoolId
            });
            sendResponse(res, exam, 'Exam scheduled', 201);
        } catch (error) {
            next(error);
        }
    }
}

export default new ExamController();
