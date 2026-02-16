import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import { processAIQuery } from '../services/ai.service';
import { sendResponse } from '../utils/response';

export async function aiQuery(req: AuthRequest, res: Response, next: NextFunction) {
    try {
        const { message } = req.body;
        const schoolId = req.schoolId;
        if (!schoolId) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }
        if (!message || typeof message !== 'string') {
            return res.status(400).json({ success: false, message: 'Message is required' });
        }
        const trimmed = message.trim();
        if (trimmed.length === 0) {
            return res.status(400).json({ success: false, message: 'Message cannot be empty' });
        }
        // Log each incoming request (if you see this 2x for one user message, frontend is double-calling)
        console.log('[AI] /ai/query called once, message length:', trimmed.length);
        const reply = await processAIQuery(schoolId, trimmed);
        return sendResponse(res, { reply }, 'OK', 200);
    } catch (error) {
        return next(error);
    }
}
