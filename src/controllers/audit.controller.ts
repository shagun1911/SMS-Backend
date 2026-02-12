import { Response, NextFunction } from 'express';
import { AuthRequest, UserRole } from '../types';
import AuditLog from '../models/auditLog.model';
import { sendResponse } from '../utils/response';

class AuditController {
    /**
     * List audit logs for the current school (or all for super admin with optional schoolId filter)
     */
    async getLogs(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const limit = Math.min(parseInt(req.query.limit as string) || 100, 200);
            const filter: Record<string, unknown> = {};
            if (req.user!.role === UserRole.SUPER_ADMIN && !req.schoolId) {
                const schoolId = req.query.schoolId as string | undefined;
                if (schoolId) filter.schoolId = schoolId;
            } else {
                filter.schoolId = req.schoolId!;
            }
            const logs = await AuditLog.find(filter)
                .sort({ createdAt: -1 })
                .limit(limit)
                .populate('userId', 'name email')
                .lean();
            sendResponse(res, logs, 'Audit logs retrieved', 200);
        } catch (error) {
            next(error);
        }
    }
}

export default new AuditController();
