import { Router } from 'express';
import { protect, authorize, multitenant } from '../middleware/auth.middleware';
import * as paymentController from '../controllers/payment.controller';
import { UserRole } from '../types';

const router = Router();

// PhonePe webhook – no auth; GET for URL validation, POST for events
router.get('/phonepe-webhook', paymentController.phonepeWebhook);
router.post('/phonepe-webhook', paymentController.phonepeWebhook);

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

router.post(
    '/generate-qr',
    protect,
    authorize(UserRole.SCHOOL_ADMIN),
    multitenant,
    paymentController.generateQrCode
);

router.get(
    '/status/:merchantTransactionId',
    protect,
    authorize(UserRole.SCHOOL_ADMIN),
    multitenant,
    paymentController.getPaymentStatus
);

router.post(
    '/confirm-phonepe',
    protect,
    authorize(UserRole.SCHOOL_ADMIN),
    multitenant,
    paymentController.confirmPhonePePayment
);

export default router;
