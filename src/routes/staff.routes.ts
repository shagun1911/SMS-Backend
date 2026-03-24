import { Router } from 'express';
import { protect, authorize, multitenant } from '../middleware/auth.middleware';
import UserController from '../controllers/user.controller';
import { UserRole } from '../types';

const router = Router();

router.use(protect);
router.use(multitenant);
router.use(authorize(UserRole.SCHOOL_ADMIN, UserRole.SUPER_ADMIN));

// Alias endpoint for explicit staff deletion trigger
router.delete('/:staffId', UserController.deleteStaff);

export default router;
