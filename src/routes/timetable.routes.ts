import { Router } from 'express';
import { protect, authorize, multitenant } from '../middleware/auth.middleware';
import TimetableController from '../controllers/timetable.controller';
import { UserRole } from '../types';

const router = Router();

router.use(protect, multitenant);

router.get('/settings', TimetableController.getSettings);
router.post('/settings', authorize(UserRole.SCHOOL_ADMIN, UserRole.TEACHER), TimetableController.upsertSettings);

router.get('/grid', TimetableController.getGrid);
router.post('/grid', authorize(UserRole.SCHOOL_ADMIN, UserRole.TEACHER), TimetableController.saveGrid);
router.get('/print', TimetableController.printGrid);

router.get('/class/:classId', TimetableController.getTimetableByClass);
router.get('/print/:classId', TimetableController.printTimetable);
router.post('/create', authorize(UserRole.SCHOOL_ADMIN, UserRole.TEACHER), TimetableController.createTimetable);
router.get('/versions', TimetableController.getVersions);
router.post('/versions/save', authorize(UserRole.SCHOOL_ADMIN, UserRole.TEACHER), TimetableController.saveVersion);
router.patch('/versions/:id/lock', authorize(UserRole.SCHOOL_ADMIN), TimetableController.lockVersion);
router.post('/copy-session', authorize(UserRole.SCHOOL_ADMIN), TimetableController.copyFromSession);

router.get('/', TimetableController.getTimetables);
router.post('/', authorize(UserRole.SCHOOL_ADMIN, UserRole.TEACHER), TimetableController.upsertTimetable);
router.put('/:id', authorize(UserRole.SCHOOL_ADMIN, UserRole.TEACHER), TimetableController.updateTimetable);
router.delete('/:id', authorize(UserRole.SCHOOL_ADMIN, UserRole.TEACHER), TimetableController.deleteTimetable);

export default router;
