import { Router } from 'express';
import { protect, authorize, multitenant } from '../middleware/auth.middleware';
import UserController from '../controllers/user.controller';
import { UserRole } from '../types';

const router = Router();

router.use(protect);
router.use(multitenant);
router.use(authorize(UserRole.SCHOOL_ADMIN, UserRole.SUPER_ADMIN));

router.route('/')
    .get(UserController.getUsers)
    .post(UserController.createUser);

router.route('/:id')
    .get(UserController.getUser)
    .put(UserController.updateUser)
    .delete(UserController.deleteUser);

export default router;
