import { Router } from 'express';
import { protect, authorize, multitenant } from '../middleware/auth.middleware';
import NotificationController from '../controllers/notification.controller';
import { UserRole } from '../types';

const router = Router();

router.use(protect, multitenant);

router.get('/', authorize(UserRole.SUPER_ADMIN, UserRole.SCHOOL_ADMIN), NotificationController.listNotifications);
router.get('/config', authorize(UserRole.SUPER_ADMIN, UserRole.SCHOOL_ADMIN), NotificationController.getConfig);
router.get('/recipients', authorize(UserRole.SUPER_ADMIN, UserRole.SCHOOL_ADMIN), NotificationController.getRecipients);
router.post('/sms', authorize(UserRole.SUPER_ADMIN, UserRole.SCHOOL_ADMIN), NotificationController.sendSms);
router.post('/email', authorize(UserRole.SUPER_ADMIN, UserRole.SCHOOL_ADMIN), NotificationController.sendEmail);

router.get('/gmail/status', authorize(UserRole.SUPER_ADMIN, UserRole.SCHOOL_ADMIN), NotificationController.gmailStatus);
router.get('/gmail/auth-url', authorize(UserRole.SUPER_ADMIN, UserRole.SCHOOL_ADMIN), NotificationController.gmailAuthUrl);
router.post('/gmail/callback', authorize(UserRole.SUPER_ADMIN, UserRole.SCHOOL_ADMIN), NotificationController.gmailCallback);
router.post('/gmail/disconnect', authorize(UserRole.SUPER_ADMIN, UserRole.SCHOOL_ADMIN), NotificationController.gmailDisconnect);

export default router;
