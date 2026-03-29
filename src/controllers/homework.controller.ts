import { Response, NextFunction } from 'express';
import Homework from '../models/homework.model';
import { AuthRequest } from '../types';
import { sendResponse } from '../utils/response';
import ErrorResponse from '../utils/errorResponse';

/** Merge legacy `attachmentUrl` with `attachments` for API consumers (mobile / web). */
function normalizeHomeworkResponse(hw: any): any {
    if (!hw || typeof hw !== 'object') return hw;
    const out = { ...hw };
    const list: any[] = Array.isArray(hw.attachments)
        ? hw.attachments.map((a: any) => ({ url: a.url, filename: a.filename, mimeType: a.mimeType }))
        : [];
    if (hw.attachmentUrl && !list.some((a) => a.url === hw.attachmentUrl)) {
        list.unshift({ url: hw.attachmentUrl, filename: 'Attachment' });
    }
    out.attachments = list;
    return out;
}

function parseAttachmentsBody(body: any): Array<{ url: string; filename?: string; mimeType?: string }> {
    let raw = body?.attachments;
    if (typeof raw === 'string') {
        try {
            raw = JSON.parse(raw);
        } catch {
            raw = [];
        }
    }
    if (!Array.isArray(raw)) return [];
    return raw
        .filter((a: any) => a && typeof a.url === 'string' && String(a.url).trim())
        .map((a: any) => ({
            url: String(a.url).trim(),
            ...(a.filename ? { filename: String(a.filename).slice(0, 240) } : {}),
            ...(a.mimeType ? { mimeType: String(a.mimeType).slice(0, 120) } : {}),
        }));
}

class HomeworkController {
    /** POST /homework — teacher/admin creates homework */
    async create(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const { className, section, subject, title, description, dueDate, attachmentUrl } = req.body;
            if (!className || !section || !subject || !title || !description) {
                return next(new ErrorResponse('className, section, subject, title, description are required', 400));
            }

            const parsedDueDate = dueDate ? new Date(dueDate) : undefined;
            if (dueDate && Number.isNaN(parsedDueDate!.getTime())) {
                return next(new ErrorResponse('dueDate is invalid', 400));
            }

            const cleanAttachments = parseAttachmentsBody(req.body);
            const legacyUrl = attachmentUrl ? String(attachmentUrl).trim() : '';
            const firstUrl = cleanAttachments[0]?.url || legacyUrl || undefined;

            const homework = await Homework.create({
                schoolId: req.schoolId,
                className,
                section: section.toString().toUpperCase(),
                subject,
                title,
                description,
                ...(parsedDueDate ? { dueDate: parsedDueDate } : {}),
                createdBy: req.user!._id,
                ...(cleanAttachments.length > 0 ? { attachments: cleanAttachments } : {}),
                ...(firstUrl ? { attachmentUrl: firstUrl } : {}),
            });
            const obj = homework.toObject();
            return sendResponse(res, normalizeHomeworkResponse(obj), 'Homework created', 201);
        } catch (error) {
            next(error);
        }
    }

    /** GET /homework?class=&section= — teacher/admin lists homework */
    async list(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const filter: any = { schoolId: req.schoolId, isActive: true };
            if (req.query.class) filter.className = req.query.class;
            if (req.query.section) filter.section = (req.query.section as string).toUpperCase();
            const homework = await Homework.find(filter)
                .populate('createdBy', 'name')
                .sort({ dueDate: 1 })
                .lean();
            return sendResponse(
                res,
                homework.map((h) => normalizeHomeworkResponse(h)),
                'Homework list',
                200
            );
        } catch (error) {
            next(error);
        }
    }

    /** GET /homework/student — student sees homework for their class+section (uses protectStudent) */
    async listForStudent(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const student = req.student!;
            const homework = await Homework.find({
                schoolId: student.schoolId,
                className: student.class,
                section: student.section,
                isActive: true,
            })
                .populate('createdBy', 'name')
                .sort({ dueDate: 1 })
                .lean();
            return sendResponse(
                res,
                homework.map((h) => normalizeHomeworkResponse(h)),
                'Homework for student',
                200
            );
        } catch (error) {
            next(error);
        }
    }

    /** DELETE /homework/:id */
    async remove(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const hw = await Homework.findOne({ _id: req.params.id, schoolId: req.schoolId });
            if (!hw) return next(new ErrorResponse('Homework not found', 404));
            hw.isActive = false;
            await hw.save();
            return sendResponse(res, {}, 'Homework deleted', 200);
        } catch (error) {
            next(error);
        }
    }
}

export default new HomeworkController();
