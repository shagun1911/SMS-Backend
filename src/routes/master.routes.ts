import { Router } from 'express';
import { protect, authorize } from '../middleware/auth.middleware';
import MasterController from '../controllers/master.controller';
import { UserRole } from '../types';
import { heavyReadLimiter } from '../middleware/rateLimiters';

const router = Router();

router.use(protect);
router.use(authorize(UserRole.SUPER_ADMIN));

router.get('/dashboard', heavyReadLimiter, MasterController.getDashboard);
router.get('/schools', MasterController.getSchools);
router.get('/schools/:id', MasterController.getSchoolDetail);
router.patch('/schools/:id', MasterController.updateSchool);
router.delete('/schools/:id', MasterController.deleteSchool);
router.patch('/schools/:id/credentials', MasterController.updateSchoolCredentials);
router.post('/schools/bulk-action', MasterController.bulkAction);

router.get('/plans', MasterController.getPlans);
router.post('/plans', MasterController.createPlan);
router.put('/plans/:id', MasterController.updatePlan);
router.delete('/plans/:id', MasterController.deletePlan);

router.get('/subscription/:schoolId', MasterController.getSubscription);
router.put('/subscription/:schoolId', MasterController.putSubscription);

router.get('/usage-reports', heavyReadLimiter, MasterController.getUsageReports);
router.get('/billing-overview', heavyReadLimiter, MasterController.getBillingOverview);

router.get('/announcements', MasterController.getAnnouncements);
router.post('/announcements', MasterController.createAnnouncement);
router.delete('/announcements/:id', MasterController.deleteAnnouncement);

router.get('/support', MasterController.getSupportTickets);
router.patch('/support/:id', MasterController.updateSupportTicket);

router.get('/system-health', heavyReadLimiter, MasterController.getSystemHealth);

export default router;
