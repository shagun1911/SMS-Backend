import { Router } from 'express';
import { protect, authorize } from '../middleware/auth.middleware';
import MasterController from '../controllers/master.controller';
import { UserRole } from '../types';

const router = Router();

router.use(protect);
router.use(authorize(UserRole.SUPER_ADMIN));

router.get('/dashboard', MasterController.getDashboard);
router.get('/schools', MasterController.getSchools);
router.patch('/schools/:id', MasterController.updateSchool);

router.get('/plans', MasterController.getPlans);
router.post('/plans', MasterController.createPlan);
router.put('/plans/:id', MasterController.updatePlan);
router.delete('/plans/:id', MasterController.deletePlan);

router.get('/subscription/:schoolId', MasterController.getSubscription);
router.put('/subscription/:schoolId', MasterController.putSubscription);

export default router;
