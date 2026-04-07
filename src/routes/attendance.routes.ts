import { Router } from 'express';
import AttendanceController from '../controllers/attendance.controller';
import { protect, authorize, multitenant } from '../middleware/auth.middleware';
import { UserRole } from '../types';

const router = Router();

router.use(protect, multitenant);

router.get(
    '/day',
    authorize(UserRole.SCHOOL_ADMIN, UserRole.TEACHER),
    AttendanceController.getDayStatus
);

router.get(
    '/me',
    authorize(
        UserRole.TEACHER,
        UserRole.ACCOUNTANT,
        UserRole.TRANSPORT_MANAGER,
        UserRole.CLEANING_STAFF,
        UserRole.STAFF_OTHER
    ),
    AttendanceController.getMyAttendance.bind(AttendanceController)
);

router.post(
    '/',
    authorize(UserRole.SCHOOL_ADMIN, UserRole.TEACHER),
    AttendanceController.submit
);

export default router;
