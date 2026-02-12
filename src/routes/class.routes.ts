import { Router } from 'express';
import { protect, authorize, multitenant } from '../middleware/auth.middleware';
import ClassController from '../controllers/class.controller';
import { UserRole } from '../types';

const router = Router();

router.use(protect, multitenant);

router.get('/', ClassController.getClasses);
router.post(
    '/',
    authorize(UserRole.SCHOOL_ADMIN),
    ClassController.createClass
);
router.patch(
    '/:id',
    authorize(UserRole.SCHOOL_ADMIN),
    ClassController.updateClass
);
router.delete(
    '/:id',
    authorize(UserRole.SCHOOL_ADMIN),
    ClassController.deleteClass
);
router.get('/:id/students', ClassController.getClassStudents);

export default router;
