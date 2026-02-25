import { Router } from 'express';
import { protect } from '../middleware/auth.middleware';
import MasterController from '../controllers/master.controller';

const router = Router();

/** GET /announcements/active – active announcements for school dashboard (any authenticated user) */
router.get('/active', protect, MasterController.getActiveAnnouncements);

export default router;
