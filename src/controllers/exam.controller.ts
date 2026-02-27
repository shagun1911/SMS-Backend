import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import Exam from '../models/exam.model';
import ExamResult from '../models/examResult.model';
import Student from '../models/student.model';
import School from '../models/school.model';
import Session from '../models/session.model';
import { sendResponse } from '../utils/response';
import { getTenantFilter } from '../utils/tenant';
import ErrorResponse from '../utils/errorResponse';
import { generateAdmitCardPDF } from '../services/pdfAdmitCard.service';
import { generateReportCardPDF } from '../services/pdfReportCard.service';

function calculateGrade(percentage: number): string {
    if (percentage >= 90) return 'A+';
    if (percentage >= 80) return 'A';
    if (percentage >= 70) return 'B+';
    if (percentage >= 60) return 'B';
    if (percentage >= 50) return 'C';
    if (percentage >= 40) return 'D';
    return 'F';
}

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

            const toNum = (v: any): number => {
                if (typeof v === 'number' && !Number.isNaN(v)) return Math.max(0, v);
                const n = parseFloat(String(v).replace(/[^0-9.-]/g, ''));
                return Number.isNaN(n) ? 0 : Math.max(0, n);
            };

            const createdResults = [];
            for (const resultData of results) {
                const student = await Student.findOne({ _id: resultData.studentId, schoolId: req.schoolId });
                if (!student) continue;

                const normalizedSubjects = (resultData.subjects || []).map((s: any) => ({
                    subject: s.subject || '',
                    maxMarks: toNum(s.maxMarks),
                    obtainedMarks: toNum(s.obtainedMarks),
                }));

                const totalMarks = normalizedSubjects.reduce((sum: number, s: any) => sum + s.maxMarks, 0);
                const totalObtained = normalizedSubjects.reduce((sum: number, s: any) => sum + s.obtainedMarks, 0);
                const percentage = totalMarks > 0 ? (totalObtained / totalMarks) * 100 : 0;
                const grade = calculateGrade(percentage);

                const result = await ExamResult.findOneAndUpdate(
                    { examId, studentId: resultData.studentId, schoolId: req.schoolId },
                    {
                        schoolId: req.schoolId,
                        examId,
                        studentId: resultData.studentId,
                        class: student.class,
                        section: student.section,
                        subjects: normalizedSubjects,
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

    async getReportCardPdf(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const { studentId } = req.params;
            const student = await Student.findOne({ _id: studentId, schoolId: req.schoolId, isActive: true });
            if (!student) return next(new ErrorResponse('Student not found', 404));
            const school = await School.findById(req.schoolId);
            if (!school) return next(new ErrorResponse('School not found', 404));
            const activeSession = await Session.findOne({ schoolId: req.schoolId, isActive: true }).lean();

            const allResults = await ExamResult.find({ schoolId: req.schoolId, studentId }).lean();
            if (!allResults.length) return next(new ErrorResponse('No exam results found for this student', 404));

            const examIds = [...new Set(allResults.map(r => r.examId.toString()))];
            const exams = await Exam.find({ _id: { $in: examIds } }).lean();
            const examMap = new Map(exams.map(e => [e._id.toString(), e]));

            const examResults = allResults
                .map(r => {
                    const exam = examMap.get(r.examId.toString());
                    return {
                        examTitle: exam?.title || 'Exam',
                        examType: exam?.type,
                        subjects: r.subjects.map((s: any) => ({
                            subject: s.subject,
                            maxMarks: s.maxMarks,
                            obtainedMarks: s.obtainedMarks,
                        })),
                        totalMarks: r.totalMarks,
                        totalObtained: r.totalObtained,
                        percentage: r.percentage,
                        grade: r.grade,
                        rank: r.rank,
                    };
                })
                .sort((a, b) => {
                    const order = ['unit_test', 'quarterly', 'half_yearly', 'annual'];
                    return order.indexOf(a.examType || '') - order.indexOf(b.examType || '');
                });

            const buffer = await generateReportCardPDF({
                school,
                sessionYear: (activeSession as any)?.sessionYear,
                student: {
                    firstName: student.firstName,
                    lastName: student.lastName,
                    admissionNumber: student.admissionNumber,
                    class: student.class,
                    section: student.section,
                    rollNumber: student.rollNumber,
                    fatherName: student.fatherName,
                    motherName: (student as any).motherName,
                    dateOfBirth: (student as any).dateOfBirth,
                    photo: (student as any).photo,
                },
                examResults,
            });

            res.setHeader('Content-Type', 'application/pdf');
            const isPreview = req.query.preview === '1' || req.query.preview === 'true';
            res.setHeader(
                'Content-Disposition',
                isPreview ? 'inline' : `attachment; filename=report-card-${studentId}.pdf`
            );
            res.send(buffer);
        } catch (error) {
            return next(error);
        }
    }

    async getAdmitCardPdf(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const { examId, studentId } = req.params;
            const exam = await Exam.findOne({ _id: examId, schoolId: req.schoolId });
            if (!exam) return next(new ErrorResponse('Exam not found', 404));
            const student = await Student.findOne({ _id: studentId, schoolId: req.schoolId, isActive: true });
            if (!student) return next(new ErrorResponse('Student not found', 404));
            const school = await School.findById(req.schoolId);
            if (!school) return next(new ErrorResponse('School not found', 404));
            const activeSession = await Session.findOne({ schoolId: req.schoolId, isActive: true }).lean();
            const buffer = await generateAdmitCardPDF({
                school,
                exam: {
                    title: exam.title,
                    startDate: exam.startDate,
                    endDate: exam.endDate,
                    type: exam.type,
                    sessionYear: (activeSession as any)?.sessionYear,
                },
                student: {
                    firstName: student.firstName,
                    lastName: student.lastName,
                    admissionNumber: student.admissionNumber,
                    class: student.class,
                    section: student.section,
                    rollNumber: student.rollNumber,
                    fatherName: student.fatherName,
                    motherName: (student as any).motherName,
                    dateOfBirth: (student as any).dateOfBirth,
                    phone: (student as any).phone,
                    photo: (student as any).photo,
                },
            });
            res.setHeader('Content-Type', 'application/pdf');
            const isPreview = req.query.preview === '1' || req.query.preview === 'true';
            res.setHeader(
                'Content-Disposition',
                isPreview ? 'inline' : `attachment; filename=admit-card-${studentId}.pdf`
            );
            res.send(buffer);
        } catch (error) {
            return next(error);
        }
    }

    /** GET /exams/student/results — student sees their own results (protectStudent) */
    async getStudentResults(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const student = req.student!;
            const results = await ExamResult.find({
                schoolId: student.schoolId,
                studentId: student._id,
            })
                .populate('examId', 'title type startDate')
                .sort({ createdAt: -1 })
                .lean();
            return sendResponse(res, results, 'Student results', 200);
        } catch (error) {
            next(error);
        }
    }

}

export default new ExamController();
