import { Router } from 'express';
import { protect, authorize, multitenant, requirePermission, TEACHER_PERMISSIONS } from '../middleware/auth.middleware';
import TimetableController from '../controllers/timetable.controller';
import { UserRole } from '../types';

const router = Router();

router.use(protect, multitenant);

// Read: any authenticated school user (teacher can view timetable)
router.get('/settings', TimetableController.getSettings);
router.post('/settings', requirePermission(TEACHER_PERMISSIONS.EDIT_TIMETABLE), TimetableController.upsertSettings);

router.get('/grid', TimetableController.getGrid);
router.post('/grid', requirePermission(TEACHER_PERMISSIONS.EDIT_TIMETABLE), TimetableController.saveGrid);
router.get('/print', TimetableController.printGrid);

router.get('/class/:classId', TimetableController.getTimetableByClass);
router.get('/print/:classId', TimetableController.printTimetable);
router.post('/create', requirePermission(TEACHER_PERMISSIONS.EDIT_TIMETABLE), TimetableController.createTimetable);
router.get('/versions', TimetableController.getVersions);
router.post('/versions/save', requirePermission(TEACHER_PERMISSIONS.EDIT_TIMETABLE), TimetableController.saveVersion);
router.patch('/versions/:id/lock', authorize(UserRole.SCHOOL_ADMIN), TimetableController.lockVersion);
router.post('/copy-session', authorize(UserRole.SCHOOL_ADMIN), TimetableController.copyFromSession);

router.get('/day', TimetableController.getDayTimetable);
router.post('/day', requirePermission(TEACHER_PERMISSIONS.EDIT_TIMETABLE), TimetableController.saveDayTimetable);

router.get('/', TimetableController.getTimetables);
router.post('/', requirePermission(TEACHER_PERMISSIONS.EDIT_TIMETABLE), TimetableController.upsertTimetable);
router.put('/:id', requirePermission(TEACHER_PERMISSIONS.EDIT_TIMETABLE), TimetableController.updateTimetable);
router.delete('/:id', requirePermission(TEACHER_PERMISSIONS.EDIT_TIMETABLE), TimetableController.deleteTimetable);

export default router;
