import { Router } from 'express';
import HomeworkController from '../controllers/homework.controller';
import { protect, protectStudent, authorize, multitenant } from '../middleware/auth.middleware';
import { UserRole } from '../types';

const router = Router();

// Student route — uses protectStudent (student JWT)
router.get('/student', protectStudent, HomeworkController.listForStudent);

// Staff routes
router.use(protect, multitenant);

router.post(
    '/',
    authorize(UserRole.SCHOOL_ADMIN, UserRole.TEACHER),
    HomeworkController.create
);

router.get(
    '/',
    authorize(UserRole.SCHOOL_ADMIN, UserRole.TEACHER),
    HomeworkController.list
);

router.delete(
    '/:id',
    authorize(UserRole.SCHOOL_ADMIN, UserRole.TEACHER),
    HomeworkController.remove
);

export default router;
