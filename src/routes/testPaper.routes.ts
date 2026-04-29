import { Router } from 'express';
import { protect, authorize, multitenant } from '../middleware/auth.middleware';
import { UserRole } from '../types';
import TestPaperController from '../controllers/testPaper.controller';

const router = Router();

router.use(protect, multitenant, authorize(UserRole.SCHOOL_ADMIN, UserRole.TEACHER));
router.get('/meta', TestPaperController.meta);
router.post('/generate', TestPaperController.generate);
router.post('/download-pdf', TestPaperController.downloadPdf);

export default router;
