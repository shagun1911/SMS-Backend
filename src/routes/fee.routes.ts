import { Router } from 'express';
import { protect, authorize, multitenant } from '../middleware/auth.middleware';
import { auditLog } from '../middleware/audit.middleware';
import { validate } from '../middleware/validate.middleware';
import {
    createFeeStructureSchema,
    updateFeeStructureSchema,
    generateFeesSchema,
    recordPaymentSchema,
    payFeeSchema,
} from '../schemas/fee.schema';
import FeeController from '../controllers/fee.controller';
import { UserRole } from '../types';

const router = Router();

router.use(protect, multitenant); // Global middlewares

router.get('/stats', FeeController.getFeeStats);
router.get('/', FeeController.listFees);

router.post(
    '/collect',
    authorize(UserRole.SCHOOL_ADMIN, UserRole.ACCOUNTANT),
    auditLog('Fees'),
    FeeController.collectFee
);

// Fee structure: list, get by class, get by id, create, update, delete, print
router.get('/structure/list', authorize(UserRole.SCHOOL_ADMIN, UserRole.ACCOUNTANT), FeeController.listStructures);
router.get('/structure/print/:id', authorize(UserRole.SCHOOL_ADMIN, UserRole.ACCOUNTANT), FeeController.printStructure);
router.get('/structure/id/:id', authorize(UserRole.SCHOOL_ADMIN, UserRole.ACCOUNTANT), FeeController.getStructureById);
router.get('/structure/:classId', authorize(UserRole.SCHOOL_ADMIN, UserRole.ACCOUNTANT), FeeController.getStructure);
router.post(
    '/structure',
    authorize(UserRole.SCHOOL_ADMIN),
    validate(createFeeStructureSchema),
    auditLog('Fees'),
    FeeController.createFeeStructure
);
router.put('/structure/:id', authorize(UserRole.SCHOOL_ADMIN), validate(updateFeeStructureSchema), auditLog('Fees'), FeeController.updateFeeStructure);
router.delete('/structure/:id', authorize(UserRole.SCHOOL_ADMIN), FeeController.deleteFeeStructure);

// Yearly fee payment (receipt + PDF)
router.post('/pay', authorize(UserRole.SCHOOL_ADMIN, UserRole.ACCOUNTANT), validate(payFeeSchema), auditLog('Fees'), FeeController.payFee);

// List payments (receipts)
router.get('/payments', authorize(UserRole.SCHOOL_ADMIN, UserRole.ACCOUNTANT), FeeController.listPayments);
// Student fee summary, receipt download, defaulters
router.get('/student/:studentId', authorize(UserRole.SCHOOL_ADMIN, UserRole.ACCOUNTANT), FeeController.getStudentFees);
router.get('/receipt/:receiptId', authorize(UserRole.SCHOOL_ADMIN, UserRole.ACCOUNTANT), FeeController.getReceipt);
router.get('/defaulters', authorize(UserRole.SCHOOL_ADMIN, UserRole.ACCOUNTANT), FeeController.getDefaulters);

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
