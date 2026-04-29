import { NextFunction, Response } from 'express';
import { AuthRequest } from '../types';
import { sendResponse } from '../utils/response';
import ErrorResponse from '../utils/errorResponse';
import {
    generateTestPaper,
    generateTestPaperPdfBuffer,
    GenerateTestPaperInput,
    GeneratedTestPaper,
    getTestPaperMeta,
} from '../services/testPaper.service';
import School from '../models/school.model';

function validatePayload(body: any): GenerateTestPaperInput {
    const questionCount = Number(body?.questionCount || 10);
    const chapters = Array.isArray(body?.chapters)
        ? body.chapters.map((x: any) => String(x).trim()).filter(Boolean)
        : [];
    const chapter = String(body?.chapter || chapters[0] || '').trim();
    if (!body?.className || !body?.subject || !chapter) {
        throw new ErrorResponse('className, subject and at least one chapter are required', 400);
    }
    if (!Number.isFinite(questionCount) || questionCount < 1 || questionCount > 100) {
        throw new ErrorResponse('questionCount must be between 1 and 100', 400);
    }
    return {
        schoolId: body.schoolId,
        schoolName: body.schoolName,
        className: String(body.className),
        subject: String(body.subject),
        chapter,
        chapters: chapters.length ? chapters : [chapter],
        topicsByChapter:
            body?.topicsByChapter && typeof body.topicsByChapter === 'object' ? body.topicsByChapter : {},
        includeWholeChapter: Boolean(body.includeWholeChapter),
        topics: body.topics ? String(body.topics) : '',
        questionType: body.questionType || 'mixed',
        difficultyLevel: body.difficultyLevel || 'mixed',
        questionCount,
        targetExam: body.targetExam || 'school',
        seniorTrack: body.seniorTrack,
        examPattern: body.examPattern || 'mixed',
        coachingStyles: Array.isArray(body.coachingStyles) ? body.coachingStyles : [],
        includePreviousYear: Boolean(body.includePreviousYear),
        prioritizeRepeated: Boolean(body.prioritizeRepeated),
        durationMinutes: Number(body.durationMinutes || 60),
        marksPerQuestion: Number(body.marksPerQuestion || 1),
        specialInstructions: body.specialInstructions ? String(body.specialInstructions) : '',
    };
}

class TestPaperController {
    async generate(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const input = validatePayload({ ...req.body, schoolId: req.schoolId });
            const paper = await generateTestPaper(input);
            return sendResponse(res, paper, 'Test paper generated', 200);
        } catch (error) {
            return next(error);
        }
    }

    async meta(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const examType = String(req.query.examType || 'boards') as any;
            const className = String(req.query.className || '');
            const subject = String(req.query.subject || '').trim();
            if (!className) {
                return next(new ErrorResponse('className is required', 400));
            }
            const data = await getTestPaperMeta({ examType, className, subject: subject || undefined });
            return sendResponse(res, data, 'Test paper meta', 200);
        } catch (error) {
            return next(error);
        }
    }

    async downloadPdf(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const paper = req.body?.paper as GeneratedTestPaper;
            if (!paper?.questions?.length) {
                return next(new ErrorResponse('Generated paper is required in request body', 400));
            }

            const school = req.schoolId ? await School.findById(req.schoolId).lean() : null;
            const schoolName = school?.schoolName || 'School';
            const buffer = await generateTestPaperPdfBuffer(paper, schoolName);

            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', 'attachment; filename=test-paper.pdf');
            return res.send(buffer);
        } catch (error) {
            return next(error);
        }
    }
}

export default new TestPaperController();
