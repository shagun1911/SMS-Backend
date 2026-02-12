import { Router } from 'express';
import { protect, authorize, multitenant } from '../middleware/auth.middleware';
import AuditController from '../controllers/audit.controller';
import { UserRole } from '../types';

const router = Router();

router.use(protect);
router.use(multitenant);

router.get(
    '/',
    authorize(UserRole.SUPER_ADMIN, UserRole.SCHOOL_ADMIN),
    AuditController.getLogs
);

export default router;
