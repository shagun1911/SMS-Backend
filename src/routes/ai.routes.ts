import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { protect, authorize, multitenant } from '../middleware/auth.middleware';
import { UserRole } from '../types';
import * as AiController from '../controllers/ai.controller';

const router = Router();

const aiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 5,
    message: { success: false, message: 'Too many AI requests. Please try again after a minute.' },
    standardHeaders: true,
    keyGenerator: (req: any) => req.user?._id?.toString() || req.ip || 'anon',
});

// Only school users: AI answers only from their school's data; Super Admin has no schoolId
router.use(protect, multitenant, authorize(UserRole.SCHOOL_ADMIN, UserRole.TEACHER, UserRole.ACCOUNTANT, UserRole.TRANSPORT_MANAGER), aiLimiter);

router.post('/query', AiController.aiQuery);

export default router;
