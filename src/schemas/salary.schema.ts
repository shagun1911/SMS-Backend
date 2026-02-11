import { z } from 'zod';
import { PaymentMode } from '../types';

export const generateSalariesSchema = z.object({
    body: z.object({
        month: z.string().min(1, 'Month is required'),
        year: z.number().int().min(2000).max(2100),
    }),
});

export const processSalaryPaymentSchema = z.object({
    body: z.object({
        amount: z.number().positive('Amount must be positive'),
        mode: z.nativeEnum(PaymentMode),
        transactionId: z.string().optional(),
        remarks: z.string().optional(),
    }),
});
