import { Router } from 'express';
import StudentAuthController from '../controllers/studentAuth.controller';
import TimetableController from '../controllers/timetable.controller';
import BusLocationController from '../controllers/busLocation.controller';
import { protectStudent } from '../middleware/auth.middleware';

const router = Router();

router.post('/login', StudentAuthController.login);
router.get('/me', protectStudent, StudentAuthController.getMe);
router.post('/update-credentials', protectStudent, StudentAuthController.updateCredentials);
router.get('/timetable', protectStudent, TimetableController.getTimetablesForCurrentStudent);
router.get('/bus-location/latest', protectStudent, BusLocationController.getStudentBusLatest);

export default router;
