import { Router } from 'express';
import { protect, authorize, multitenant } from '../middleware/auth.middleware';
import { validate } from '../middleware/validate.middleware';
import { createOtherPaymentSchema } from '../schemas/salary.schema';
import OtherPaymentController from '../controllers/otherPayment.controller';
import { UserRole } from '../types';

const router = Router();

router.use(protect, multitenant);

router.get(
    '/me',
    authorize(UserRole.TEACHER, UserRole.ACCOUNTANT, UserRole.TRANSPORT_MANAGER),
    OtherPaymentController.listMine
);

router.get(
    '/staff/:staffId',
    authorize(UserRole.SUPER_ADMIN, UserRole.SCHOOL_ADMIN, UserRole.ACCOUNTANT),
    OtherPaymentController.listForStaff
);

router.post(
    '/staff/:staffId',
    authorize(UserRole.SUPER_ADMIN, UserRole.SCHOOL_ADMIN, UserRole.ACCOUNTANT),
    validate(createOtherPaymentSchema),
    OtherPaymentController.createForStaff
);

export default router;

