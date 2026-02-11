import { Router } from 'express';
import { protect, authorize, multitenant } from '../middleware/auth.middleware';
import { auditLog } from '../middleware/audit.middleware';
import { validate } from '../middleware/validate.middleware';
import {
    createFeeStructureSchema,
    generateFeesSchema,
    recordPaymentSchema
} from '../schemas/fee.schema';
import FeeController from '../controllers/fee.controller';
import { UserRole } from '../types';

const router = Router();

router.use(protect, multitenant); // Global middlewares

router.get('/', FeeController.listFees);

// Structure
router.post(
    '/structure',
    authorize(UserRole.SUPER_ADMIN, UserRole.SCHOOL_ADMIN),
    validate(createFeeStructureSchema),
    auditLog('Fees'),
    FeeController.createFeeStructure
); // Create class structure

// Generation
router.post(
    '/generate',
    authorize(UserRole.SCHOOL_ADMIN, UserRole.ACCOUNTANT),
    validate(generateFeesSchema),
    auditLog('Fees'),
    FeeController.generateFees
); // Monthly run

// Payments
router.post(
    '/:feeId/pay',
    authorize(UserRole.SCHOOL_ADMIN, UserRole.ACCOUNTANT),
    validate(recordPaymentSchema),
    auditLog('Fees'),
    FeeController.recordPayment
); // Pay Fee

// Reports
router.get(
    '/ledger/:studentId',
    authorize(UserRole.SCHOOL_ADMIN, UserRole.ACCOUNTANT, UserRole.TEACHER, UserRole.SUPER_ADMIN), // Parents/Students too if implemented
    FeeController.getStudentLedger
);
router.get(
    '/reports/collection',
    authorize(UserRole.SCHOOL_ADMIN, UserRole.ACCOUNTANT, UserRole.SUPER_ADMIN),
    FeeController.getCollectionReport
); // Monthly analytics

export default router;
