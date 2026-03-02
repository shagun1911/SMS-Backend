import { Router } from 'express';
import { protect, multitenant } from '../middleware/auth.middleware';
import UserNotificationController from '../controllers/userNotification.controller';

const router = Router();

// Protect all and require multitenant processing
router.use(protect);
// Optional: Multitenant might require req.user.schoolId, which we have if logged in
router.use(multitenant);

router.get('/', UserNotificationController.getMyNotifications);
router.patch('/read-all', UserNotificationController.markAllAsRead);
router.patch('/:id/read', UserNotificationController.markAsRead);

export default router;
