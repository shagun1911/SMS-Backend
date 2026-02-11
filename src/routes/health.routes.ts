import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';

const router = Router();

router.get('/health', async (_req: Request, res: Response) => {
    const dbStatus = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';

    res.status(200).json({
        status: 'up',
        timestamp: new Date().toISOString(),
        database: dbStatus,
        uptime: process.uptime(),
        memoryUsage: process.memoryUsage(),
    });
});

export default router;
