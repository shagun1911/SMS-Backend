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

// ─── Shared CSV normalizer ────────────────────────────────────────────────────

function parseCSV(input: unknown, maxItems = 50): string[] {
    const raw = String(input || '');
    const seen = new Set<string>();
    const result: string[] = [];
    for (const part of raw.replace(/,+/g, ',').replace(/^,|,$/g, '').split(',')) {
        const s = part.trim();
        if (!s) continue;
        const key = s.toLowerCase();
        if (!seen.has(key)) { seen.add(key); result.push(s); }
        if (result.length >= maxItems) break;
    }
    return result;
}

// ─── Validate + normalize request payload ────────────────────────────────────

function validatePayload(body: any): GenerateTestPaperInput {
    // ── Subject (mandatory) ───────────────────────────────────────────────────
    const subjectRaw = String(body?.subject || '').trim();
    if (!subjectRaw) {
        console.warn('[TP] invalid_input field=subject reason=empty');
        throw new ErrorResponse('At least one subject is required', 400);
    }
    const subjectList = parseCSV(subjectRaw, 10);
    if (subjectList.length === 0) {
        console.warn('[TP] invalid_input field=subject reason=empty_after_parse');
        throw new ErrorResponse('At least one subject is required', 400);
    }
    if (subjectList.length > 10) {
        console.warn('[TP] invalid_input field=subject reason=too_many');
        throw new ErrorResponse('Too many subjects provided (max 10)', 400);
    }
    const subject = subjectList[0];

    // ── Class ─────────────────────────────────────────────────────────────────
    if (!body?.className) {
        throw new ErrorResponse('className is required', 400);
    }

    // ── Chapters (optional — empty = full syllabus) ───────────────────────────
    const chaptersRaw = Array.isArray(body?.chapters)
        ? body.chapters.map(String).join(',')
        : String(body?.chapters || body?.chapter || '');
    const chapters = parseCSV(chaptersRaw, 20);
    if (chapters.length > 20) {
        console.warn('[TP] invalid_input field=chapters reason=too_many');
        throw new ErrorResponse('Too many chapters provided (max 20)', 400);
    }
    const chapter = chapters[0] || 'Full Syllabus';

    // ── Topics (optional) ─────────────────────────────────────────────────────
    const topicsList = parseCSV(String(body?.topics || ''), 30);
    if (topicsList.length > 30) {
        console.warn('[TP] invalid_input field=topics reason=too_many');
        throw new ErrorResponse('Too many topics provided (max 30)', 400);
    }
    const topics = topicsList.join(', ');

    // Topic vs chapter conflict hint — appended to special instructions
    const conflictHint =
        topicsList.length > 0 && chapters.length > 0
            ? 'Focus primarily on the provided topics. If topics and chapters conflict, prioritize topics.'
            : '';

    // ── Question count ────────────────────────────────────────────────────────
    const questionCount = Number(body?.questionCount);
    if (!Number.isFinite(questionCount) || questionCount < 1 || questionCount > 100) {
        console.warn('[TP] invalid_input field=questionCount reason=out_of_range');
        throw new ErrorResponse('questionCount must be between 1 and 100', 400);
    }

    // ── Difficulty distribution ───────────────────────────────────────────────
    let difficultyDistribution: GenerateTestPaperInput['difficultyDistribution'];
    if (body.difficultyDistribution && typeof body.difficultyDistribution === 'object') {
        const e = Number(body.difficultyDistribution.easy ?? 0);
        const m = Number(body.difficultyDistribution.medium ?? 0);
        const h = Number(body.difficultyDistribution.hard ?? 0);
        const sum = e + m + h;
        if (e === 0 && m === 0 && h === 0) {
            console.warn('[TP] invalid_input field=difficultyDistribution reason=all_zeros');
            throw new ErrorResponse('difficultyDistribution cannot be all zeros', 400);
        }
        if (Math.abs(sum - 100) > 1) {
            console.warn(`[TP] invalid_input field=difficultyDistribution reason=invalid_sum sum=${sum}`);
            throw new ErrorResponse(`difficultyDistribution must sum to 100 (got ${sum})`, 400);
        }
        difficultyDistribution = { easy: e, medium: m, hard: h };
    }

    // ── Type distribution ─────────────────────────────────────────────────────
    let typeDistribution: GenerateTestPaperInput['typeDistribution'];
    if (body.typeDistribution && typeof body.typeDistribution === 'object') {
        const o = Number(body.typeDistribution.objective ?? 0);
        const s = Number(body.typeDistribution.subjective ?? 0);
        const sum = o + s;
        if (o === 0 && s === 0) {
            console.warn('[TP] invalid_input field=typeDistribution reason=all_zeros');
            throw new ErrorResponse('typeDistribution cannot be all zeros', 400);
        }
        if (Math.abs(sum - 100) > 1) {
            console.warn(`[TP] invalid_input field=typeDistribution reason=invalid_sum sum=${sum}`);
            throw new ErrorResponse(`typeDistribution must sum to 100 (got ${sum})`, 400);
        }
        typeDistribution = { objective: o, subjective: s };
    }

    // ── Teacher questions ─────────────────────────────────────────────────────
    const teacherQuestions = Array.isArray(body.teacherQuestions)
        ? body.teacherQuestions
              .filter((q: any) => q?.question && String(q.question).trim().length > 5)
              .map((q: any) => ({
                  question: String(q.question).trim(),
                  type: q.type === 'subjective' ? 'subjective' : 'objective',
                  difficulty: (['easy', 'medium', 'hard'] as const).includes(q.difficulty)
                      ? q.difficulty
                      : 'medium',
                  options: Array.isArray(q.options) ? q.options.map(String) : [],
                  answer: q.answer ? String(q.answer) : '',
                  marks: q.marks ? Number(q.marks) : undefined,
              }))
        : [];

    const baseInstructions = body.specialInstructions
        ? String(body.specialInstructions).trim()
        : '';

    return {
        schoolId: body.schoolId,
        schoolName: body.schoolName,
        className: String(body.className),
        subject,
        chapter,
        chapters: chapters.length ? chapters : [chapter],
        topicsByChapter: {},
        includeWholeChapter: chapters.length === 0,
        topics,
        specialInstructions: [baseInstructions, conflictHint].filter(Boolean).join(' '),
        questionType: body.questionType || 'mixed',
        difficultyLevel: body.difficultyLevel || 'mixed',
        difficultyDistribution,
        typeDistribution,
        teacherQuestions,
        questionCount,
        targetExam: String(body.targetExam || 'school').trim() || 'school',
        seniorTrack: body.seniorTrack,
        examPattern: body.examPattern || 'mixed',
        coachingStyles: Array.isArray(body.coachingStyles) ? body.coachingStyles : [],
        includePreviousYear: Boolean(body.includePreviousYear),
        prioritizeRepeated: Boolean(body.prioritizeRepeated),
        durationMinutes: Number(body.durationMinutes || 60),
        marksPerQuestion: Number(body.marksPerQuestion || 1),
    };
}

class TestPaperController {
    async generate(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const input = validatePayload({ ...req.body, schoolId: req.schoolId });
            const paper = await generateTestPaper(input);
            if (res.headersSent) {
                console.warn("[TP] Request timed out, discarding generated paper.");
                return;
            }
            return sendResponse(res, paper, 'Test paper generated', 200);
        } catch (error) {
            if (res.headersSent) return;
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
