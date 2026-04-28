import { Router } from 'express';
import AdmissionEnquiryController from '../controllers/admissionEnquiry.controller';
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
        AdmissionEnquiryController.createEnquiry
    )
    .get(AdmissionEnquiryController.getEnquiries);

router.get(
    '/stats',
    AdmissionEnquiryController.getEnquiryStats
);

router.get(
    '/count',
    AdmissionEnquiryController.getEnquiryCount
);

router
    .route('/:id')
    .get(AdmissionEnquiryController.getEnquiry)
    .put(
        authorize(UserRole.SCHOOL_ADMIN, UserRole.ACCOUNTANT),
        AdmissionEnquiryController.updateEnquiry
    )
    .delete(
        authorize(UserRole.SCHOOL_ADMIN),
        AdmissionEnquiryController.deleteEnquiry
    );

export default router;
