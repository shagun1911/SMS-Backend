import { Router } from 'express';
import { protect, authorize, multitenant, requireTransportView } from '../middleware/auth.middleware';
import TransportController from '../controllers/transport.controller';
import { UserRole } from '../types';

const router = Router();

router.use(protect, multitenant);

/** Add/update buses and assign students — same roles for every mutating route (avoid POST/PUT drift). */
const canManageTransport = authorize(
    UserRole.SCHOOL_ADMIN,
    UserRole.SUPER_ADMIN,
    UserRole.TRANSPORT_MANAGER
);

// Teachers with view_transport permission can view bus routes (read-only)
router.get('/', requireTransportView, TransportController.getFleet);
router.get('/crew-options', canManageTransport, TransportController.getCrewOptions);
router.get('/:busId/details', requireTransportView, TransportController.getBusDetails);
router.post('/', canManageTransport, TransportController.addVehicle);
router.put('/:busId', canManageTransport, TransportController.updateVehicle);
router.post('/:busId/students', canManageTransport, TransportController.assignStudentsToBus);
router.delete('/:busId/students', canManageTransport, TransportController.unassignStudentsFromBus);

export default router;
