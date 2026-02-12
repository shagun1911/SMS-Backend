import { Router } from 'express';
import { protect, authorize, multitenant } from '../middleware/auth.middleware';
import SessionController from '../controllers/session.controller';
import { UserRole } from '../types';

const router = Router();

router.use(protect, multitenant);

router.get('/', SessionController.getSessions);
router.post(
    '/',
    authorize(UserRole.SCHOOL_ADMIN, UserRole.SUPER_ADMIN),
    SessionController.createSession
);
router.patch(
    '/:id',
    authorize(UserRole.SCHOOL_ADMIN, UserRole.SUPER_ADMIN),
    SessionController.updateSession
);

export default router;
