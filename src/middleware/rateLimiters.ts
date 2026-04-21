import rateLimit from 'express-rate-limit';
import type { Request } from 'express';

function keyFor(req: Request): string {
    const schoolId = (req as any)?.schoolId ? String((req as any).schoolId) : '';
    // Prefer tenant-scoped limiting to reduce shared-NAT false positives.
    const ip = req.ip || (req as any).connection?.remoteAddress || 'unknown';
    return schoolId ? `${ip}:${schoolId}` : ip;
}

/**
 * For read-heavy endpoints (dashboard, reports) that can be abused.
 * Keep generous limits; rely on caching for performance.
 */
export const heavyReadLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 120, // 2 req/sec per IP+tenant
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: keyFor,
    message: { success: false, message: 'Too many requests, please slow down.' },
});

/**
 * For expensive endpoints (defaulters, analytics) to avoid DB overload.
 */
export const expensiveReadLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: keyFor,
    message: { success: false, message: 'Too many requests, please try again shortly.' },
});

/**
 * Standard list endpoints that are not computation-heavy but should still be bounded.
 */
export const normalReadLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: keyFor,
    message: { success: false, message: 'Too many requests, please slow down.' },
});

/**
 * Write operations (create/update/delete) — tighter than reads.
 */
export const writeOperationLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: keyFor,
    message: { success: false, message: 'Too many write requests, please slow down.' },
});

/**
 * Notification sending (SMS/email blasts) — very tight to prevent abuse.
 */
export const notificationSendLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: keyFor,
    message: { success: false, message: 'Too many notification requests, please wait.' },
});

/**
 * Student login — brute-force protection.
 */
export const studentAuthLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 15,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Too many login attempts. Please try again after 15 minutes.' },
});
