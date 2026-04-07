import { Router } from 'express';
import TransportAttendanceController from '../controllers/transportAttendance.controller';
import { authorize, multitenant, protect } from '../middleware/auth.middleware';
import { UserRole } from '../types';

const router = Router();

router.use(protect, multitenant);

router.get(
    '/',
    authorize(UserRole.TRANSPORT_MANAGER, UserRole.SCHOOL_ADMIN),
    TransportAttendanceController.getByDate.bind(TransportAttendanceController)
);
router.post(
    '/save',
    authorize(UserRole.TRANSPORT_MANAGER, UserRole.SCHOOL_ADMIN),
    TransportAttendanceController.saveDraft.bind(TransportAttendanceController)
);
router.post(
    '/final-submit',
    authorize(UserRole.TRANSPORT_MANAGER, UserRole.SCHOOL_ADMIN),
    TransportAttendanceController.finalSubmit.bind(TransportAttendanceController)
);
router.get(
    '/user/:userId',
    authorize(
        UserRole.TRANSPORT_MANAGER,
        UserRole.SCHOOL_ADMIN,
        UserRole.BUS_DRIVER,
        UserRole.CONDUCTOR
    ),
    TransportAttendanceController.getUserHistory.bind(TransportAttendanceController)
);

export default router;
