import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { protect, multitenant } from '../middleware/auth.middleware';
import * as AiController from '../controllers/ai.controller';

const router = Router();

const aiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 5,
    message: { success: false, message: 'Too many AI requests. Please try again after a minute.' },
    standardHeaders: true,
    keyGenerator: (req: any) => req.user?._id?.toString() || req.ip || 'anon',
});

router.use(protect, multitenant, aiLimiter);

router.post('/query', AiController.aiQuery);

export default router;
