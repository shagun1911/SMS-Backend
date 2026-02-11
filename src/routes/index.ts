import { Router } from 'express';
import authRoutes from './auth.routes';
import studentRoutes from './student.routes';
import feeRoutes from './fee.routes';
import salaryRoutes from './salary.routes';
import schoolRoutes from './school.routes';
import masterRoutes from './master.routes';
import userRoutes from './user.routes';
import attendanceRoutes from './attendance.routes';
import examRoutes from './exam.routes';
import transportRoutes from './transport.routes';
import uploadRoutes from './upload.routes';

const router = Router();

router.use('/auth', authRoutes);
router.use('/master', masterRoutes);
router.use('/schools', schoolRoutes);
router.use('/students', studentRoutes);
router.use('/fees', feeRoutes);
router.use('/salaries', salaryRoutes);
router.use('/users', userRoutes);
router.use('/attendance', attendanceRoutes);
router.use('/exams', examRoutes);
router.use('/transport', transportRoutes);
router.use('/upload', uploadRoutes);

export default router;
