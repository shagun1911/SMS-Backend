import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import ErrorResponse from '../utils/errorResponse';
import User from '../models/user.model';
import Student from '../models/student.model';

const MAX_TOKEN_LEN = 4096;

function normalizeToken(raw: unknown): string | null {
    if (typeof raw !== 'string') return null;
    const t = raw.trim();
    if (!t || t.length > MAX_TOKEN_LEN) return null;
    return t;
}

class FcmController {
    async saveDeviceToken(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const token = normalizeToken(req.body?.token);
            if (!token) {
                return next(new ErrorResponse('Valid device token is required', 400));
            }
            const userId = req.user!._id;
            await User.updateOne({ _id: userId }, { $addToSet: { fcmTokens: token } });
            return res.status(200).json({ success: true, message: 'Device token saved' });
        } catch (e) {
            return next(e);
        }
    }

    async saveStudentDeviceToken(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const token = normalizeToken(req.body?.token);
            if (!token) {
                return next(new ErrorResponse('Valid device token is required', 400));
            }
            const studentId = req.student!._id;
            await Student.updateOne({ _id: studentId }, { $addToSet: { fcmTokens: token } });
            return res.status(200).json({ success: true, message: 'Device token saved' });
        } catch (e) {
            return next(e);
        }
    }
}

export default new FcmController();
