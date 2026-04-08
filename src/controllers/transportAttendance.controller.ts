import { NextFunction, Response } from 'express';
import mongoose from 'mongoose';
import { AuthRequest, UserRole } from '../types';
import ErrorResponse from '../utils/errorResponse';
import User from '../models/user.model';
import TransportAttendance from '../models/transportAttendance.model';
import UserNotification from '../models/userNotification.model';
import { sendNotificationToStaffUsers } from '../services/fcm.service';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CREW_ROLES: UserRole[] = [UserRole.BUS_DRIVER, UserRole.CONDUCTOR];

function assertNotFutureYmd(dateStr: string, req: AuthRequest): void {
    if (!DATE_RE.test(dateStr)) {
        throw new ErrorResponse('Invalid date format; use YYYY-MM-DD', 400);
    }
    const rawHeader = req.headers['x-client-date'];
    const header =
        typeof rawHeader === 'string'
            ? rawHeader.trim().split(',')[0].trim()
            : Array.isArray(rawHeader)
              ? String(rawHeader[0] ?? '').trim()
              : '';
    if (DATE_RE.test(header)) {
        if (dateStr > header) throw new ErrorResponse('Cannot mark attendance for a future date', 400);
        return;
    }
    const [y, m, d] = dateStr.split('-').map(Number);
    const inputUtc = Date.UTC(y, m - 1, d);
    const now = new Date();
    const utcTodayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    if (inputUtc > utcTodayStart + 24 * 60 * 60 * 1000) {
        throw new ErrorResponse('Cannot mark attendance for a future date', 400);
    }
}

class TransportAttendanceController {
    async getByDate(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const schoolId = req.schoolId!;
            const date = String(req.query.date || '');
            if (!DATE_RE.test(date)) return next(new ErrorResponse('Query ?date=YYYY-MM-DD is required', 400));
            const page = Math.max(1, Number(req.query.page) || 1);
            const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));

            const roleQ = String(req.query.role || '').trim();
            const roleFilter =
                roleQ === UserRole.BUS_DRIVER || roleQ === UserRole.CONDUCTOR ? (roleQ as UserRole) : undefined;
            const search = String(req.query.search || '').trim();

            const query: Record<string, unknown> = {
                schoolId,
                role: roleFilter ? roleFilter : { $in: CREW_ROLES },
                isActive: { $ne: false },
            };
            if (search) query.name = { $regex: search, $options: 'i' };

            const users = await User.find(query)
                .select('name role totalAbsentCount')
                .sort({ name: 1 })
                .skip((page - 1) * limit)
                .limit(limit)
                .lean();
            const ids = users.map((u) => u._id);

            const docs =
                ids.length === 0
                    ? []
                    : await TransportAttendance.find({ schoolId, date, userId: { $in: ids } })
                          .select('userId status isFinal')
                          .lean();
            const byUser = new Map<string, { status: 'present' | 'absent'; isFinal: boolean }>();
            let isFinalized = false;
            for (const d of docs) {
                byUser.set(String(d.userId), { status: d.status, isFinal: Boolean(d.isFinal) });
                if (d.isFinal) isFinalized = true;
            }

            const data = users.map((u) => {
                const row = byUser.get(String(u._id));
                return {
                    _id: u._id,
                    name: u.name,
                    role: u.role,
                    status: row?.status ?? 'pending',
                    isFinal: row?.isFinal ?? false,
                    totalAbsentCount: Number((u as { totalAbsentCount?: number }).totalAbsentCount ?? 0),
                };
            });

            return res
                .status(200)
                .json({ success: true, data: { date, isFinal: isFinalized, page, limit, users: data } });
        } catch (e) {
            return next(e);
        }
    }

    async saveDraft(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const schoolId = req.schoolId!;
            const managerId = req.user!._id;
            const { date, presentUserIds } = req.body as { date?: string; presentUserIds?: string[] };
            if (!date || !DATE_RE.test(date)) return next(new ErrorResponse('date is required (YYYY-MM-DD)', 400));
            assertNotFutureYmd(date, req);

            const finalizedExists = await TransportAttendance.findOne({ schoolId, date, isFinal: true })
                .select('_id')
                .lean();
            if (finalizedExists) return next(new ErrorResponse('Attendance is already finalized for this date', 409));

            const eligible = await User.find({
                schoolId,
                role: { $in: CREW_ROLES },
                isActive: { $ne: false },
            })
                .select('_id')
                .lean();
            const allowed = new Set(eligible.map((u) => String(u._id)));
            const presentSet = new Set((Array.isArray(presentUserIds) ? presentUserIds : []).map(String));
            for (const id of presentSet) {
                if (!allowed.has(id)) return next(new ErrorResponse('presentUserIds contains invalid staff id', 400));
            }

            const schoolOid = new mongoose.Types.ObjectId(schoolId);
            const session = await mongoose.startSession();
            try {
                await session.withTransaction(async () => {
                    for (const u of eligible) {
                        const uid = String(u._id);
                        const userOid = new mongoose.Types.ObjectId(uid);
                        if (presentSet.has(uid)) {
                            await TransportAttendance.findOneAndUpdate(
                                { schoolId: schoolOid, userId: userOid, date },
                                {
                                    $set: {
                                        schoolId: schoolOid,
                                        userId: userOid,
                                        date,
                                        status: 'present',
                                        markedBy: managerId,
                                        isFinal: false,
                                    },
                                },
                                { upsert: true, new: true, session }
                            );
                        } else {
                            await TransportAttendance.deleteOne(
                                { schoolId: schoolOid, userId: userOid, date, isFinal: false },
                                { session }
                            );
                        }
                    }
                });
            } finally {
                session.endSession();
            }

            return res.status(200).json({ success: true, message: 'Draft attendance saved' });
        } catch (e) {
            return next(e);
        }
    }

    async finalSubmit(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const schoolId = req.schoolId!;
            const managerId = req.user!._id;
            const { date, presentUserIds } = req.body as { date?: string; presentUserIds?: string[] };
            if (!date || !DATE_RE.test(date)) return next(new ErrorResponse('date is required (YYYY-MM-DD)', 400));
            assertNotFutureYmd(date, req);

            const finalizedExists = await TransportAttendance.findOne({ schoolId, date, isFinal: true })
                .select('_id')
                .lean();
            if (finalizedExists) return next(new ErrorResponse('Attendance is already finalized for this date', 409));

            const users = await User.find({
                schoolId,
                role: { $in: CREW_ROLES },
                isActive: { $ne: false },
            })
                .select('_id name role totalAbsentCount')
                .lean();
            const presentSet = new Set((Array.isArray(presentUserIds) ? presentUserIds : []).map(String));
            const allowed = new Set(users.map((u) => String(u._id)));
            for (const id of presentSet) {
                if (!allowed.has(id)) return next(new ErrorResponse('presentUserIds contains invalid staff id', 400));
            }

            const schoolOid = new mongoose.Types.ObjectId(schoolId);
            let absentCount = 0;
            let presentCount = 0;
            const absentNotifications: Array<{
                userId: mongoose.Types.ObjectId;
                schoolId: mongoose.Types.ObjectId;
                title: string;
                message: string;
                type: string;
                isRead: boolean;
                metadata: Record<string, unknown>;
            }> = [];

            const session = await mongoose.startSession();
            try {
                await session.withTransaction(async () => {
                    for (const u of users) {
                        const uid = String(u._id);
                        const userOid = new mongoose.Types.ObjectId(uid);
                        const status: 'present' | 'absent' = presentSet.has(uid) ? 'present' : 'absent';
                        const prev = await TransportAttendance.findOne({ schoolId, userId: userOid, date })
                            .select('status')
                            .session(session)
                            .lean();

                        await TransportAttendance.findOneAndUpdate(
                            { schoolId: schoolOid, userId: userOid, date },
                            {
                                $set: {
                                    schoolId: schoolOid,
                                    userId: userOid,
                                    date,
                                    status,
                                    markedBy: managerId,
                                    isFinal: true,
                                },
                            },
                            { upsert: true, new: true, session }
                        );

                        if (status === 'absent') {
                            absentCount += 1;
                            if (prev == null || prev.status !== 'absent') {
                                await User.updateOne({ _id: userOid }, { $inc: { totalAbsentCount: 1 } }).session(session);
                            }
                            absentNotifications.push({
                                userId: userOid,
                                schoolId: schoolOid,
                                title: 'Attendance Alert',
                                message: 'You have been marked absent today.',
                                type: 'attendance',
                                isRead: false,
                                metadata: { date, status: 'absent' },
                            });
                        } else {
                            presentCount += 1;
                        }
                    }

                    if (absentNotifications.length > 0) {
                        await UserNotification.insertMany(absentNotifications, { session });
                    }
                });
            } finally {
                session.endSession();
            }

            if (absentNotifications.length > 0) {
                const ids = [...new Set(absentNotifications.map((n) => String(n.userId)))];
                void sendNotificationToStaffUsers(
                    ids,
                    'Attendance Alert',
                    'You have been marked absent today.'
                );
            }

            return res.status(200).json({
                success: true,
                message: 'Attendance finalized',
                data: { date, isFinal: true, presentCount, absentCount },
            });
        } catch (e) {
            return next(e);
        }
    }

    async getUserHistory(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const schoolId = req.schoolId!;
            const userId = req.params.userId;
            const role = req.user?.role as UserRole | undefined;
            if (
                role &&
                (role === UserRole.BUS_DRIVER || role === UserRole.CONDUCTOR) &&
                String(req.user?._id) !== String(userId)
            ) {
                return next(new ErrorResponse('Not authorized to view another user attendance', 403));
            }
            const year = Number(req.query.year);
            const month = Number(req.query.month);

            const user = await User.findOne({ _id: userId, schoolId, role: { $in: CREW_ROLES } })
                .select('name role totalAbsentCount')
                .lean();
            if (!user) return next(new ErrorResponse('User not found', 404));

            const query: Record<string, unknown> = { schoolId, userId };
            if (Number.isFinite(year) && Number.isFinite(month) && month >= 1 && month <= 12) {
                const mm = String(month).padStart(2, '0');
                const start = `${year}-${mm}-01`;
                const end = `${year}-${mm}-${String(new Date(year, month, 0).getDate()).padStart(2, '0')}`;
                query.date = { $gte: start, $lte: end };
            }

            const rows = await TransportAttendance.find(query)
                .select('date status isFinal')
                .sort({ date: 1 })
                .lean();

            return res.status(200).json({
                success: true,
                data: {
                    user: {
                        _id: user._id,
                        name: user.name,
                        role: user.role,
                        totalAbsentCount: Number((user as { totalAbsentCount?: number }).totalAbsentCount ?? 0),
                    },
                    attendance: rows,
                },
            });
        } catch (e) {
            return next(e);
        }
    }
}

export default new TransportAttendanceController();
