import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';

const router = Router();

async function handler(_req: Request, res: Response) {
    const dbStatus = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';

    res.status(200).json({
        status: 'up',
        timestamp: new Date().toISOString(),
        database: dbStatus,
        uptime: process.uptime(),
        memoryUsage: process.memoryUsage(),
    });
}

// Mounted at `/health` in `server.ts` so `GET /health` works
router.get('/', handler);
// Backward-compatible if anyone hits `/health/health`
router.get('/health', handler);

export default router;
