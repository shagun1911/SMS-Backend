import { Router } from 'express';
import { protect, authorize, multitenant } from '../middleware/auth.middleware';
import ExamController from '../controllers/exam.controller';
import { UserRole } from '../types';

const router = Router();

router.use(protect, multitenant);

router.get('/', ExamController.getExams);
router.post('/', authorize(UserRole.SCHOOL_ADMIN, UserRole.TEACHER), ExamController.createExam);
router.patch('/:id', authorize(UserRole.SCHOOL_ADMIN, UserRole.TEACHER), ExamController.updateExam);
router.delete('/:id', authorize(UserRole.SCHOOL_ADMIN), ExamController.deleteExam);

router.post('/:examId/results', authorize(UserRole.SCHOOL_ADMIN, UserRole.TEACHER), ExamController.addResults);
router.get('/:examId/results', ExamController.getExamResults);
router.get('/:examId/merit', ExamController.getMeritList);
router.get('/:examId/admit-cards', ExamController.getAdmitCards);

export default router;
