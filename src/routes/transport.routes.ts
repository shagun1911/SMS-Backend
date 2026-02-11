import { Router } from 'express';
import { protect, authorize, multitenant } from '../middleware/auth.middleware';
import TransportController from '../controllers/transport.controller';
import { UserRole } from '../types';

const router = Router();

router.use(protect, multitenant);

router.get('/', authorize(UserRole.SCHOOL_ADMIN, UserRole.TRANSPORT_MANAGER, UserRole.SUPER_ADMIN), TransportController.getFleet);
router.post('/', authorize(UserRole.SCHOOL_ADMIN, UserRole.SUPER_ADMIN), TransportController.addVehicle);

export default router;
