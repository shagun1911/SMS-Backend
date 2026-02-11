import { Response, NextFunction } from 'express';
import { AuthRequest, AuditAction } from '../types';
import AuditRepository from '../repositories/audit.repository';

/**
 * Audit Log Middleware
 * Logs critical actions automatically based on Route + Method
 */
export const auditLog = (moduleName: string) => {
    return (req: AuthRequest, res: Response, next: NextFunction) => {
        // Monkey patch res.send to intercept response body if needed
        // But for simplicity and performance, we log based on request success
        const originalSend = res.send;

        res.send = function (body) {
            if (res.statusCode >= 200 && res.statusCode < 300) {
                // Only log successful actions
                const userId = req.user?._id;
                const schoolId = req.schoolId || req.user?.schoolId;

                if (userId) {
                    let action: AuditAction = AuditAction.UPDATE;
                    let description = `Performed action on ${moduleName}`;

                    // Determine Action Type
                    if (req.method === 'POST') action = AuditAction.CREATE;
                    if (req.method === 'PUT' || req.method === 'PATCH') action = AuditAction.UPDATE;
                    if (req.method === 'DELETE') action = AuditAction.DELETE;

                    // Special Cases
                    if (req.path.includes('/pay')) action = AuditAction.PAYMENT;
                    if (req.path.includes('/promote')) action = AuditAction.PROMOTION;
                    if (req.path.includes('/login')) action = AuditAction.LOGIN;
                    if (req.path.includes('/logout')) action = AuditAction.LOGOUT;
                    if (req.path.includes('/salary/pay')) action = AuditAction.SALARY_PAYMENT;

                    // Special Descriptions
                    if (action === AuditAction.CREATE) description = `Created new ${moduleName}`;
                    if (action === AuditAction.UPDATE) description = `Updated ${moduleName}`;
                    if (action === AuditAction.DELETE) description = `Deleted ${moduleName}`;
                    if (action === AuditAction.PAYMENT) description = `Processed payment for ${moduleName}`;
                    if (action === AuditAction.SALARY_PAYMENT) description = `Processed salary payment`;

                    // Async logging (fire and forget)
                    AuditRepository.create({
                        schoolId: schoolId as any,
                        userId: userId as any,
                        action,
                        module: moduleName,
                        description,
                        metadata: {
                            method: req.method,
                            path: req.originalUrl,
                            body: req.method !== 'GET' ? req.body : undefined, // Log body for mutations
                            params: req.params,
                            query: req.query,
                            ip: req.ip,
                        },
                        ipAddress: req.ip,
                        userAgent: req.get('user-agent'),
                    }).catch(err => console.error('Audit Log Error:', err));
                }
            }
            return originalSend.call(this, body);
        };

        next();
    };
};
