import { Router } from 'express';
import { protect, authorize, multitenant } from '../middleware/auth.middleware';
import * as paymentController from '../controllers/payment.controller';
import { UserRole } from '../types';

const router = Router();

router.post(
    '/create-order',
    protect,
    authorize(UserRole.SCHOOL_ADMIN),
    multitenant,
    paymentController.createOrder
);

router.post(
    '/verify',
    protect,
    authorize(UserRole.SCHOOL_ADMIN),
    multitenant,
    paymentController.verifyPayment
);

export default router;
