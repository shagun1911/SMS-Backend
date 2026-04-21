import { Router } from 'express';
import { protect, protectStudent, authorize, multitenant } from '../middleware/auth.middleware';
import ExamController from '../controllers/exam.controller';
import { UserRole } from '../types';
import { normalReadLimiter } from '../middleware/rateLimiters';

const router = Router();

// Student self-serve results
router.get('/student/results', protectStudent, ExamController.getStudentResults);

router.use(protect, multitenant);

router.get('/', normalReadLimiter, ExamController.getExams);
router.post('/', authorize(UserRole.SCHOOL_ADMIN, UserRole.TEACHER), ExamController.createExam);
router.patch('/:id', authorize(UserRole.SCHOOL_ADMIN, UserRole.TEACHER), ExamController.updateExam);
router.delete('/:id', authorize(UserRole.SCHOOL_ADMIN), ExamController.deleteExam);

router.get('/report-card/:studentId', ExamController.getReportCardPdf);
router.get('/:examId/report-card/:studentId', ExamController.getExamReportCardPdf);

router.post('/:examId/results', authorize(UserRole.SCHOOL_ADMIN, UserRole.TEACHER), ExamController.addResults);
router.get('/:examId/results', ExamController.getExamResults);
router.get('/:examId/merit', ExamController.getMeritList);
router.get('/:examId/admit-cards/:studentId/pdf', ExamController.getAdmitCardPdf);
router.get('/:examId/admit-cards', ExamController.getAdmitCards);

export default router;
