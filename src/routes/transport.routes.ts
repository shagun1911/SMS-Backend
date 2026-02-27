import { Router } from 'express';
import { protect, authorize, multitenant, requireTransportView } from '../middleware/auth.middleware';
import TransportController from '../controllers/transport.controller';
import { UserRole } from '../types';

const router = Router();

router.use(protect, multitenant);

// Teachers with view_transport permission can view bus routes (read-only)
router.get('/', requireTransportView, TransportController.getFleet);
router.post('/', authorize(UserRole.SCHOOL_ADMIN, UserRole.SUPER_ADMIN), TransportController.addVehicle);

export default router;
