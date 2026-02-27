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

router.get(
    '/promote/preview',
    authorize(UserRole.SCHOOL_ADMIN),
    StudentController.promotionPreview
);

router.post(
    '/promote',
    authorize(UserRole.SCHOOL_ADMIN),
    StudentController.promoteStudents
);

router.get(
    '/:id/id-card',
    authorize(UserRole.SCHOOL_ADMIN, UserRole.TEACHER),
    StudentController.getIdCardPdf
);

router.post(
    '/:id/set-password',
    authorize(UserRole.SCHOOL_ADMIN),
    StudentController.setStudentPassword
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
