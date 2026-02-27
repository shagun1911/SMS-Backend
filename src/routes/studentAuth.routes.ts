import { Router } from 'express';
import StudentAuthController from '../controllers/studentAuth.controller';
import { protectStudent } from '../middleware/auth.middleware';

const router = Router();

router.post('/login', StudentAuthController.login);
router.get('/me', protectStudent, StudentAuthController.getMe);
router.post('/change-password', protectStudent, StudentAuthController.changePassword);

export default router;
