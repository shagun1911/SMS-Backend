import { z } from 'zod';
import { FeeType, PaymentMode } from '../types';

export const createFeeStructureSchema = z.object({
    body: z.object({
        class: z.string().min(1, 'Class is required'),
        fees: z.array(z.object({
            title: z.string().min(1, 'Fee title is required'),
            type: z.nativeEnum(FeeType),
            amount: z.number().positive('Amount must be positive'),
            isOptional: z.boolean().default(false),
            description: z.string().optional(),
        })).min(1, 'At least one fee item is required'),
        totalAnnualFee: z.number().positive('Total annual fee must be positive'),
    }),
});

export const generateFeesSchema = z.object({
    body: z.object({
        className: z.string().min(1, 'Class name is required'),
        month: z.string().min(1, 'Month is required'),
        dueDate: z.string().datetime('Invalid date format for dueDate'),
    }),
});

export const recordPaymentSchema = z.object({
    body: z.object({
        amount: z.number().positive('Payment amount must be positive'),
        mode: z.nativeEnum(PaymentMode),
        transactionId: z.string().optional(),
        remarks: z.string().optional(),
    }),
});
