import { Router } from 'express';
import { protect, authorize, multitenant } from '../middleware/auth.middleware';
import SchoolController from '../controllers/school.controller';
import { UserRole } from '../types';

const router = Router();

// Public registration
router.post('/register', SchoolController.register);

// Public school info (for student/parent portals)
router.get('/public/:code', SchoolController.getPublicByCode);

// Master admin school deletion (must be before multitenant middleware)
router.delete(
    '/:schoolId',
    protect,
    authorize(UserRole.SUPER_ADMIN),
    SchoolController.deleteSchoolByMaster
);

// Protected routes
router.use(protect);
router.use(multitenant);

router.get('/me', SchoolController.getMySchool);
router.patch('/me', authorize(UserRole.SCHOOL_ADMIN, UserRole.SUPER_ADMIN), SchoolController.updateMySchool);
router.get('/stats', authorize(UserRole.SCHOOL_ADMIN), SchoolController.getDashboardStats);
router.get('/plans', SchoolController.getPlans);

export default router;
