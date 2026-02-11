import { Router } from 'express';
import UploadController from '../controllers/upload.controller';
import { protect, multitenant } from '../middleware/auth.middleware';
import upload from '../middleware/upload.middleware';

const router = Router();

router.use(protect);
router.use(multitenant);

router.post('/image', upload.single('image'), UploadController.uploadImage);

export default router;
