import { Router } from 'express';
import { protect, authorize, multitenant } from '../middleware/auth.middleware';
import AttendanceController from '../controllers/attendance.controller';
import { UserRole } from '../types';

const router = Router();

router.use(protect, multitenant);

router.get('/', authorize(UserRole.SCHOOL_ADMIN, UserRole.TEACHER, UserRole.SUPER_ADMIN), AttendanceController.getAttendance);
router.post('/mark', authorize(UserRole.SCHOOL_ADMIN, UserRole.TEACHER), AttendanceController.markAttendance);

export default router;
