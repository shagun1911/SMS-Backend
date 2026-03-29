import { Router } from 'express';
import { protect, authorize, multitenant, requireTransportView } from '../middleware/auth.middleware';
import TransportController from '../controllers/transport.controller';
import { UserRole } from '../types';

const router = Router();

router.use(protect, multitenant);

// Teachers with view_transport permission can view bus routes (read-only)
router.get('/', requireTransportView, TransportController.getFleet);
router.get(
    '/crew-options',
    authorize(UserRole.SCHOOL_ADMIN, UserRole.SUPER_ADMIN, UserRole.TRANSPORT_MANAGER),
    TransportController.getCrewOptions
);
router.get('/:busId/details', requireTransportView, TransportController.getBusDetails);
router.post('/', authorize(UserRole.SCHOOL_ADMIN, UserRole.SUPER_ADMIN), TransportController.addVehicle);
router.put(
    '/:busId',
    authorize(UserRole.SCHOOL_ADMIN, UserRole.SUPER_ADMIN, UserRole.TRANSPORT_MANAGER),
    TransportController.updateVehicle
);
router.post(
    '/:busId/students',
    authorize(UserRole.SCHOOL_ADMIN, UserRole.SUPER_ADMIN, UserRole.TRANSPORT_MANAGER),
    TransportController.assignStudentsToBus
);
router.delete(
    '/:busId/students',
    authorize(UserRole.SCHOOL_ADMIN, UserRole.SUPER_ADMIN, UserRole.TRANSPORT_MANAGER),
    TransportController.unassignStudentsFromBus
);

export default router;
