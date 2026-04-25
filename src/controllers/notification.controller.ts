import { Response, NextFunction } from 'express';
import { Types } from 'mongoose';
import { AuthRequest } from '../types';
import Student from '../models/student.model';
import School from '../models/school.model';
import Notification from '../models/notification.model';
import { isTwilioConfigured } from '../services/twilio.service';
import { isGmailConfigured, getAuthUrl, getTokensFromCode } from '../services/gmail.service';
import ErrorResponse from '../utils/errorResponse';
import { sendResponse } from '../utils/response';
import { getNotificationQueue } from '../utils/queue';

const gmailTokens = new Map<string, { access_token: string; refresh_token?: string }>();

class NotificationController {
    /** GET /notifications – list past notifications for school */
    async listNotifications(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const schoolId = req.schoolId;
            const page = parseInt(req.query.page as string, 10) || 1;
            const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
            const safePage = Math.max(1, page);
            const skip = (safePage - 1) * limit;
            const [rows, total] = await Promise.all([
                Notification.find({ schoolId })
                    .select('type subject message targetGroup recipientCount status sentCount failedCount createdBy createdAt')
                    .sort({ createdAt: -1 })
                    .skip(skip)
                    .limit(limit)
                    .populate('createdBy', 'name')
                    .lean(),
                Notification.countDocuments({ schoolId }),
            ]);
            res.setHeader('X-Total-Count', String(total));
            res.setHeader('X-Page', String(safePage));
            res.setHeader('X-Limit', String(limit));
            sendResponse(res, { rows, pagination: { total, page: safePage, pages: Math.ceil(total / limit) } }, 'OK', 200);
        } catch (err) { next(err); }
    }

    /** GET /notifications/recipients?target=all|defaulters|custom&ids=... */
    async getRecipients(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const schoolId = req.schoolId;
            const target = (req.query.target as string) || 'all';
            const customIds = req.query.ids ? (req.query.ids as string).split(',') : [];
            const students = await getTargetStudents(schoolId!, target, customIds);
            const recipients = students.map((s: any) => ({
                _id: s._id,
                name: s.fullName || `${s.firstName} ${s.lastName}`,
                phone: s.phone,
                email: s.email,
                class: s.class,
                section: s.section,
                dueAmount: s.dueAmount,
            }));
            sendResponse(res, { recipients, count: recipients.length }, 'OK', 200);
        } catch (err) { next(err); }
    }

    /** POST /notifications/sms – send SMS */
    async sendSms(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            if (!isTwilioConfigured()) return next(new ErrorResponse('Twilio is not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER.', 503));
            const schoolId = req.schoolId!;
            const userId = req.user!._id;
            const { message, target, customIds } = req.body as { message: string; target: string; customIds?: string[] };
            if (!message?.trim()) return next(new ErrorResponse('Message is required', 400));

            const school = await School.findById(schoolId).lean();
            const schoolName = (school as any)?.name || 'School';
            const students = await getTargetStudents(schoolId, target, customIds);
            const studentsWithPhone = students.filter((s: any) => s.phone);
            if (studentsWithPhone.length === 0) return next(new ErrorResponse('No recipients with phone numbers found', 400));

            const notif = await Notification.create({
                schoolId, type: 'sms', message, targetGroup: target || 'all',
                recipientCount: studentsWithPhone.length, status: 'sending', createdBy: userId,
            });

            const queue = getNotificationQueue();
            if (!queue) return next(new ErrorResponse('Background job processing is temporarily unavailable. Please try again later.', 503));
            await queue.add('sendSms', {
                notificationId: notif._id.toString(),
                schoolId,
                type: 'sms',
                targetGroup: target || 'all',
                customIds,
                message,
                schoolName,
            });

            sendResponse(res, { status: 'queued', total: studentsWithPhone.length }, 'SMS sending initiated in the background', 202);
        } catch (err) { next(err); }
    }

    /** GET /notifications/gmail/status – check if Gmail tokens exist */
    async gmailStatus(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const schoolId = req.schoolId!;
            const connected = gmailTokens.has(schoolId);
            const configured = isGmailConfigured();
            sendResponse(res, { configured, connected }, 'OK', 200);
        } catch (err) { next(err); }
    }

    /** GET /notifications/gmail/auth-url – get Google OAuth URL */
    async gmailAuthUrl(_req: AuthRequest, res: Response, next: NextFunction) {
        try {
            if (!isGmailConfigured()) return next(new ErrorResponse('Google OAuth not configured', 503));
            const url = getAuthUrl();
            sendResponse(res, { url }, 'OK', 200);
        } catch (err) { next(err); }
    }

    /** POST /notifications/gmail/callback – exchange code for tokens */
    async gmailCallback(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const { code } = req.body;
            if (!code) return next(new ErrorResponse('Authorization code required', 400));
            const tokens = await getTokensFromCode(code);
            if (!tokens.access_token) return next(new ErrorResponse('Failed to get tokens from Google', 400));
            gmailTokens.set(req.schoolId!, {
                access_token: tokens.access_token,
                refresh_token: tokens.refresh_token ?? undefined,
            });
            sendResponse(res, { connected: true }, 'Gmail connected', 200);
        } catch (err) { next(err); }
    }

    /** POST /notifications/gmail/disconnect */
    async gmailDisconnect(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            gmailTokens.delete(req.schoolId!);
            sendResponse(res, { connected: false }, 'Gmail disconnected', 200);
        } catch (err) { next(err); }
    }

    /** POST /notifications/email – send email via Gmail */
    async sendEmail(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const schoolId = req.schoolId!;
            const userId = req.user!._id;
            const tokens = gmailTokens.get(schoolId);
            if (!tokens) return next(new ErrorResponse('Gmail not connected. Please connect your Gmail account first.', 400));

            const { subject, message, target, customIds } = req.body as { subject: string; message: string; target: string; customIds?: string[] };
            if (!subject?.trim() || !message?.trim()) return next(new ErrorResponse('Subject and message are required', 400));

            const school = await School.findById(schoolId).lean();
            const schoolName = (school as any)?.name || 'School';
            const students = await getTargetStudents(schoolId, target, customIds);
            const studentsWithEmail = students.filter((s: any) => s.email);
            if (studentsWithEmail.length === 0) return next(new ErrorResponse('No recipients with email addresses found', 400));

            const notif = await Notification.create({
                schoolId, type: 'email', subject, message, targetGroup: target || 'all',
                recipientCount: studentsWithEmail.length, status: 'sending', createdBy: userId,
            });

            const queue = getNotificationQueue();
            if (!queue) return next(new ErrorResponse('Background job processing is temporarily unavailable. Please try again later.', 503));
            await queue.add('sendEmail', {
                notificationId: notif._id.toString(),
                schoolId,
                type: 'email',
                targetGroup: target || 'all',
                customIds,
                subject,
                message,
                schoolName,
                tokens,
            });

            sendResponse(res, { status: 'queued', total: studentsWithEmail.length }, 'Email sending initiated in the background', 202);
        } catch (err) { next(err); }
    }

    /** GET /notifications/config – what's configured */
    async getConfig(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            sendResponse(res, {
                sms: isTwilioConfigured(),
                email: isGmailConfigured(),
                gmailConnected: gmailTokens.has(req.schoolId!),
            }, 'OK', 200);
        } catch (err) { next(err); }
    }
}

async function getTargetStudents(schoolId: string, target: string, customIds?: string[]) {
    const filter: any = { schoolId: new Types.ObjectId(schoolId), isActive: true };
    if (target === 'defaulters') filter.dueAmount = { $gt: 0 };
    if (target === 'custom' && customIds?.length) filter._id = { $in: customIds.map((id) => new Types.ObjectId(id)) };
    return Student.find(filter).sort({ class: 1, section: 1 }).lean();
}

export default new NotificationController();
