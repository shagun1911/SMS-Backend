import { Router } from 'express';
import { protect, authorize, multitenant } from '../middleware/auth.middleware';
import TimetableController from '../controllers/timetable.controller';
import { UserRole } from '../types';

const router = Router();

router.use(protect, multitenant);

router.get('/', TimetableController.getTimetables);
router.post('/', authorize(UserRole.SCHOOL_ADMIN, UserRole.TEACHER), TimetableController.upsertTimetable);

export default router;
