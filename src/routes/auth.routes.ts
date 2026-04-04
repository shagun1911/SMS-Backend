import { Router } from 'express';
import { protect, authorize } from '../middleware/auth.middleware';
import AuthController from '../controllers/auth.controller';
import BusLocationController from '../controllers/busLocation.controller';
import { UserRole } from '../types';

const router = Router();

router.post('/register', AuthController.register);
router.post('/login', AuthController.login);
router.get('/me', protect, AuthController.getMe);
router.get('/logout', protect, AuthController.logout);
router.post('/change-password', protect, AuthController.changePassword);
router.post('/verify-password', protect, AuthController.verifyPassword);
router.post('/refresh-token', AuthController.refreshToken);

router.get(
    '/crew/bus-assignment',
    protect,
    authorize(UserRole.BUS_DRIVER, UserRole.CONDUCTOR),
    BusLocationController.getCrewBusAssignment
);
router.post(
    '/crew/bus-location',
    protect,
    authorize(UserRole.BUS_DRIVER, UserRole.CONDUCTOR),
    BusLocationController.postCrewLocation
);

export default router;
