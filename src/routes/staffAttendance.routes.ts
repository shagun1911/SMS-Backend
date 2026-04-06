import { Router } from 'express';
import StaffAttendanceController from '../controllers/staffAttendance.controller';
import { protect, authorize, multitenant } from '../middleware/auth.middleware';
import { UserRole } from '../types';

const router = Router();

router.use(protect, multitenant, authorize(UserRole.SCHOOL_ADMIN));

router.get('/eligible', StaffAttendanceController.getEligible.bind(StaffAttendanceController));
router.get('/day', StaffAttendanceController.getDayAbsences.bind(StaffAttendanceController));
router.post('/day', StaffAttendanceController.saveDay.bind(StaffAttendanceController));
router.get(
    '/staff/:staffId/month',
    StaffAttendanceController.getStaffMonth.bind(StaffAttendanceController)
);

export default router;
