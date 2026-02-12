import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import Exam from '../models/exam.model';
import ExamResult from '../models/examResult.model';
import Student from '../models/student.model';
import { sendResponse } from '../utils/response';
import { getTenantFilter } from '../utils/tenant';
import ErrorResponse from '../utils/errorResponse';

class ExamController {
    async getExams(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const filter = getTenantFilter(req.schoolId!);
            const exams = await Exam.find(filter).sort({ startDate: -1 });
            return sendResponse(res, exams, 'Exams retrieved', 200);
        } catch (error) {
            return next(error);
        }
    }

    async createExam(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const exam = await Exam.create({
                ...req.body,
                schoolId: req.schoolId,
            });
            return sendResponse(res, exam, 'Exam created', 201);
        } catch (error) {
            return next(error);
        }
    }

    async updateExam(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const exam = await Exam.findOne({ _id: req.params.id, schoolId: req.schoolId });
            if (!exam) {
                return next(new ErrorResponse('Exam not found', 404));
            }
            const updated = await Exam.findByIdAndUpdate(req.params.id, req.body, { new: true });
            return sendResponse(res, updated, 'Exam updated', 200);
        } catch (error) {
            return next(error);
        }
    }

    async deleteExam(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const exam = await Exam.findOne({ _id: req.params.id, schoolId: req.schoolId });
            if (!exam) {
                return next(new ErrorResponse('Exam not found', 404));
            }
            await Exam.findByIdAndDelete(req.params.id);
            return sendResponse(res, {}, 'Exam deleted', 200);
        } catch (error) {
            return next(error);
        }
    }

    async addResults(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const { examId } = req.params;
            const { results } = req.body; // Array of {studentId, subjects: [{subject, maxMarks, obtainedMarks}]}

            const exam = await Exam.findOne({ _id: examId, schoolId: req.schoolId });
            if (!exam) {
                return next(new ErrorResponse('Exam not found', 404));
            }

            const createdResults = [];
            for (const resultData of results) {
                const student = await Student.findOne({ _id: resultData.studentId, schoolId: req.schoolId });
                if (!student) continue;

                const totalMarks = resultData.subjects.reduce((sum: number, s: any) => sum + s.maxMarks, 0);
                const totalObtained = resultData.subjects.reduce((sum: number, s: any) => sum + s.obtainedMarks, 0);
                const percentage = (totalObtained / totalMarks) * 100;
                const grade = this.calculateGrade(percentage);

                const result = await ExamResult.findOneAndUpdate(
                    { examId, studentId: resultData.studentId, schoolId: req.schoolId },
                    {
                        schoolId: req.schoolId,
                        examId,
                        studentId: resultData.studentId,
                        class: student.class,
                        section: student.section,
                        subjects: resultData.subjects,
                        totalMarks,
                        totalObtained,
                        percentage,
                        grade,
                    },
                    { upsert: true, new: true }
                );
                createdResults.push(result);
            }

            return sendResponse(res, createdResults, 'Results added successfully', 201);
        } catch (error) {
            return next(error);
        }
    }

    async getExamResults(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const { examId } = req.params;
            const filter = { ...getTenantFilter(req.schoolId!), examId };
            const results = await ExamResult.find(filter).populate('studentId', 'firstName lastName admissionNumber photo');
            return sendResponse(res, results, 'Results retrieved', 200);
        } catch (error) {
            return next(error);
        }
    }

    async getMeritList(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const { examId } = req.params;
            const { classFilter, limit } = req.query;

            const filter: any = { ...getTenantFilter(req.schoolId!), examId };
            if (classFilter) filter.class = classFilter;

            const results = await ExamResult.find(filter)
                .populate('studentId', 'firstName lastName admissionNumber photo')
                .sort({ percentage: -1 })
                .limit(limit ? Number(limit) : 100);

            // Assign ranks
            results.forEach((result, index) => {
                result.rank = index + 1;
            });

            await Promise.all(results.map(r => r.save()));

            return sendResponse(res, results, 'Merit list generated', 200);
        } catch (error) {
            return next(error);
        }
    }

    async getAdmitCards(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const { examId } = req.params;
            const { class: className, section } = req.query;
            const exam = await Exam.findOne({ _id: examId, schoolId: req.schoolId });
            if (!exam) {
                return next(new ErrorResponse('Exam not found', 404));
            }
            const filter: any = { schoolId: req.schoolId, isActive: true };
            if (className) filter.class = className;
            if (section) filter.section = section;
            const students = await Student.find(filter).sort({ class: 1, section: 1, rollNumber: 1 });
            const cards = students.map((s, idx) => ({
                student: {
                    _id: s._id,
                    firstName: s.firstName,
                    lastName: s.lastName,
                    admissionNumber: s.admissionNumber,
                    class: s.class,
                    section: s.section,
                    rollNumber: s.rollNumber ?? idx + 1,
                    photo: s.photo,
                    fatherName: s.fatherName,
                    dateOfBirth: s.dateOfBirth,
                },
                exam: {
                    title: exam.title,
                    startDate: exam.startDate,
                    endDate: exam.endDate,
                    type: exam.type,
                },
            }));
            return sendResponse(res, cards, 'Admit cards generated', 200);
        } catch (error) {
            return next(error);
        }
    }

    private calculateGrade(percentage: number): string {
        if (percentage >= 90) return 'A+';
        if (percentage >= 80) return 'A';
        if (percentage >= 70) return 'B+';
        if (percentage >= 60) return 'B';
        if (percentage >= 50) return 'C';
        if (percentage >= 40) return 'D';
        return 'F';
    }
}

export default new ExamController();
