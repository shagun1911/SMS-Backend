import { Router } from 'express';
import { protect } from '../middleware/auth.middleware';
import AuthController from '../controllers/auth.controller';

const router = Router();

router.post('/register', AuthController.register);
router.post('/login', AuthController.login);
router.get('/me', protect, AuthController.getMe);
router.get('/logout', protect, AuthController.logout);
router.post('/change-password', protect, AuthController.changePassword);
router.post('/verify-password', protect, AuthController.verifyPassword);
router.post('/refresh-token', AuthController.refreshToken);

export default router;
