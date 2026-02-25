import { Router } from 'express';
import { protect } from '../middleware/auth.middleware';
import SupportController from '../controllers/support.controller';

const router = Router();

router.use(protect);

router.post('/tickets', SupportController.createTicket);
router.get('/tickets', SupportController.getMyTickets);

export default router;
