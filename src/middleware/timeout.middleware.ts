import type { Request, Response, NextFunction } from 'express';
import ErrorResponse from '../utils/errorResponse';

/**
 * Server-side request timeout guard.
 *
 * Important:
 * - This does not cancel in-flight DB work, but it prevents stuck/slow requests
 *   from occupying the event loop and client connections indefinitely.
 */
export function requestTimeout(ms: number) {
    const timeoutMs = Math.max(1000, Math.floor(ms || 0));
    return function timeoutMiddleware(req: Request, res: Response, next: NextFunction) {
        // If the client disconnects, don't keep writing.
        const onAborted = () => {
            // Mark so downstream can choose to stop early (best effort).
            (req as any).abortedByClient = true;
        };
        req.on('aborted', onAborted);

        res.setTimeout(timeoutMs, () => {
            if (res.headersSent) return;
            // Let the global error handler format response consistently.
            next(new ErrorResponse('Request timeout. Please try again.', 504));
        });

        next();
    };
}

