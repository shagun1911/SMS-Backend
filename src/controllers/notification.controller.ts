import { Response, NextFunction } from 'express';
import { Types } from 'mongoose';
import { AuthRequest } from '../types';
import Student from '../models/student.model';
import School from '../models/school.model';
import Notification from '../models/notification.model';
import { sendBulkSms, isTwilioConfigured, SmsSendResult } from '../services/twilio.service';
import { sendBulkEmail, isGmailConfigured, getAuthUrl, getTokensFromCode } from '../services/gmail.service';
import ErrorResponse from '../utils/errorResponse';
import { sendResponse } from '../utils/response';

const gmailTokens = new Map<string, { access_token: string; refresh_token?: string }>();

function replaceVars(template: string, student: any, schoolName: string): string {
    return template
        .replace(/\{name\}/gi, student.fullName || `${student.firstName || ''} ${student.lastName || ''}`.trim())
        .replace(/\{firstName\}/gi, student.firstName || '')
        .replace(/\{lastName\}/gi, student.lastName || '')
        .replace(/\{fatherName\}/gi, student.fatherName || '')
        .replace(/\{motherName\}/gi, student.motherName || '')
        .replace(/\{class\}/gi, student.class || '')
        .replace(/\{section\}/gi, student.section || '')
        .replace(/\{phone\}/gi, student.phone || '')
        .replace(/\{email\}/gi, student.email || '')
        .replace(/\{admissionNumber\}/gi, student.admissionNumber || '')
        .replace(/\{amount\}/gi, student.dueAmount != null ? `₹${Number(student.dueAmount).toLocaleString('en-IN')}` : '₹0')
        .replace(/\{dueAmount\}/gi, student.dueAmount != null ? `₹${Number(student.dueAmount).toLocaleString('en-IN')}` : '₹0')
        .replace(/\{paidAmount\}/gi, student.paidAmount != null ? `₹${Number(student.paidAmount).toLocaleString('en-IN')}` : '₹0')
        .replace(/\{totalFee\}/gi, student.totalYearlyFee != null ? `₹${Number(student.totalYearlyFee).toLocaleString('en-IN')}` : '₹0')
        .replace(/\{school\}/gi, schoolName)
        .replace(/\{date\}/gi, new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }))
        .replace(/\{dueDate\}/gi, new Date(Date.now() + 7 * 86400000).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }));
}

class NotificationController {
    /** GET /notifications – list past notifications for school */
    async listNotifications(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const schoolId = req.schoolId;
            const page = parseInt(req.query.page as string) || 1;
            const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
            const skip = (page - 1) * limit;
            const [rows, total] = await Promise.all([
                Notification.find({ schoolId }).sort({ createdAt: -1 }).skip(skip).limit(limit).populate('createdBy', 'name').lean(),
                Notification.countDocuments({ schoolId }),
            ]);
            sendResponse(res, { rows, pagination: { total, page, pages: Math.ceil(total / limit) } }, 'OK', 200);
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

            const hasVars = /\{[a-zA-Z]+\}/.test(message);
            let result: { sent: number; failed: number; results: SmsSendResult[] };
            if (hasVars) {
                const allResults: SmsSendResult[] = [];
                let sent = 0, failed = 0;
                const BATCH = 10;
                for (let i = 0; i < studentsWithPhone.length; i += BATCH) {
                    const batch = studentsWithPhone.slice(i, i + BATCH);
                    const promises = batch.map(async (s: any) => {
                        const personalizedMsg = replaceVars(message, s, schoolName);
                        const r = await sendBulkSms([s.phone], personalizedMsg);
                        sent += r.sent; failed += r.failed;
                        allResults.push(...r.results);
                    });
                    await Promise.all(promises);
                }
                result = { sent, failed, results: allResults };
            } else {
                result = await sendBulkSms(studentsWithPhone.map((s: any) => s.phone), message);
            }
            notif.sentCount = result.sent;
            notif.failedCount = result.failed;
            notif.status = result.failed === studentsWithPhone.length ? 'failed' : 'completed';
            await notif.save();

            sendResponse(res, { sent: result.sent, failed: result.failed, total: studentsWithPhone.length }, 'SMS sent', 200);
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

            const hasVars = /\{[a-zA-Z]+\}/.test(message) || /\{[a-zA-Z]+\}/.test(subject);
            let result;
            if (hasVars) {
                let sent = 0, failed = 0;
                const BATCH = 5;
                for (let i = 0; i < studentsWithEmail.length; i += BATCH) {
                    const batch = studentsWithEmail.slice(i, i + BATCH);
                    const recipients = batch.map((s: any) => ({
                        email: s.email,
                        name: s.fullName || `${s.firstName} ${s.lastName}`,
                    }));
                    const promises = batch.map(async (s: any, idx: number) => {
                        const personalSubject = replaceVars(subject, s, schoolName);
                        const personalBody = replaceVars(message, s, schoolName);
                        const r = await sendBulkEmail(tokens, [recipients[idx]], personalSubject, personalBody, schoolName);
                        sent += r.sent; failed += r.failed;
                    });
                    await Promise.all(promises);
                }
                result = { sent, failed };
            } else {
                const recipients = studentsWithEmail.map((s: any) => ({
                    email: s.email,
                    name: s.fullName || `${s.firstName} ${s.lastName}`,
                }));
                result = await sendBulkEmail(tokens, recipients, subject, message, schoolName);
            }
            notif.sentCount = result.sent;
            notif.failedCount = result.failed;
            notif.status = result.failed === studentsWithEmail.length ? 'failed' : 'completed';
            await notif.save();

            sendResponse(res, { sent: result.sent, failed: result.failed, total: studentsWithEmail.length }, 'Email sent', 200);
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
