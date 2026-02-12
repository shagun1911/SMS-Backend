import { Router } from 'express';
import authRoutes from './auth.routes';
import studentRoutes from './student.routes';
import feeRoutes from './fee.routes';
import salaryRoutes from './salary.routes';
import schoolRoutes from './school.routes';
import masterRoutes from './master.routes';
import userRoutes from './user.routes';
import examRoutes from './exam.routes';
import transportRoutes from './transport.routes';
import uploadRoutes from './upload.routes';
import salaryStructureRoutes from './salaryStructure.routes';
import otherPaymentRoutes from './otherPayment.routes';
import auditRoutes from './audit.routes';
import sessionRoutes from './session.routes';
import classRoutes from './class.routes';
import timetableRoutes from './timetable.routes';

const router = Router();

router.use('/auth', authRoutes);
router.use('/master', masterRoutes);
router.use('/schools', schoolRoutes);
router.use('/students', studentRoutes);
router.use('/fees', feeRoutes);
router.use('/salaries', salaryRoutes);
router.use('/salary-structure', salaryStructureRoutes);
router.use('/salary-other-payments', otherPaymentRoutes);
router.use('/users', userRoutes);
router.use('/exams', examRoutes);
router.use('/transport', transportRoutes);
router.use('/upload', uploadRoutes);
router.use('/audit-logs', auditRoutes);
router.use('/sessions', sessionRoutes);
router.use('/classes', classRoutes);
router.use('/timetable', timetableRoutes);

export default router;
