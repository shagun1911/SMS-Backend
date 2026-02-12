import { Router } from 'express';
import StudentController from '../controllers/student.controller';
import { protect, authorize, multitenant } from '../middleware/auth.middleware';
import { UserRole } from '../types';

const router = Router();

// Apply protection to all routes
router.use(protect);
router.use(multitenant);

router
    .route('/')
    .post(
        authorize(UserRole.SCHOOL_ADMIN, UserRole.ACCOUNTANT),
        StudentController.createStudent
    )
    .get(StudentController.getStudents);

router.post(
    '/import',
    authorize(UserRole.SCHOOL_ADMIN, UserRole.ACCOUNTANT),
    StudentController.importStudents
);

router
    .route('/:id')
    .get(StudentController.getStudent)
    .put(
        authorize(UserRole.SCHOOL_ADMIN, UserRole.ACCOUNTANT),
        StudentController.updateStudent
    )
    .delete(
        authorize(UserRole.SCHOOL_ADMIN),
        StudentController.deleteStudent
    );

export default router;
