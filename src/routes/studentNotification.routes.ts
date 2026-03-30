import { Router } from 'express';
import StudentNotificationController from '../controllers/studentNotification.controller';
import { protectStudent } from '../middleware/auth.middleware';

const router = Router();

router.use(protectStudent);

router.get('/', StudentNotificationController.listMine);
router.patch('/read-all', StudentNotificationController.markAllRead);
router.patch('/:id/read', StudentNotificationController.markRead);

export default router;
