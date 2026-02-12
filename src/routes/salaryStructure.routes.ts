import { Router } from 'express';
import { protect, authorize, multitenant } from '../middleware/auth.middleware';
import { validate } from '../middleware/validate.middleware';
import { upsertSalaryStructureSchema } from '../schemas/salary.schema';
import SalaryStructureController from '../controllers/salaryStructure.controller';
import { UserRole } from '../types';

const router = Router();

router.use(protect, multitenant);

// View current salary structure for a staff member
router.get(
    '/staff/:staffId',
    authorize(UserRole.SUPER_ADMIN, UserRole.SCHOOL_ADMIN, UserRole.ACCOUNTANT),
    SalaryStructureController.getByStaff
);

// Create or update salary structure for a staff member
router.put(
    '/staff/:staffId',
    authorize(UserRole.SUPER_ADMIN, UserRole.SCHOOL_ADMIN, UserRole.ACCOUNTANT),
    validate(upsertSalaryStructureSchema),
    SalaryStructureController.upsertForStaff
);

export default router;

