import { Router } from 'express';
import { protect, authorize } from '../middleware/auth.middleware';
import MasterController from '../controllers/master.controller';
import { UserRole } from '../types';

const router = Router();

// All master routes require superadmin role
router.use(protect);
router.use(authorize(UserRole.SUPER_ADMIN));

router.get('/stats', MasterController.getGlobalStats);
router.get('/schools', MasterController.getSchools);
router.get('/activity', MasterController.getGlobalActivity);
router.patch('/schools/:id', MasterController.updateSchool);

export default router;
