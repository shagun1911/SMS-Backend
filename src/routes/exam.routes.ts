import { Router } from 'express';
import { protect, authorize, multitenant } from '../middleware/auth.middleware';
import ExamController from '../controllers/exam.controller';
import { UserRole } from '../types';

const router = Router();

router.use(protect, multitenant);

router.get('/', authorize(UserRole.SCHOOL_ADMIN, UserRole.TEACHER, UserRole.SUPER_ADMIN), ExamController.getExams);
router.post('/', authorize(UserRole.SCHOOL_ADMIN, UserRole.SUPER_ADMIN), ExamController.createExam);

export default router;
