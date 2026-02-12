import { z } from 'zod';
import { PaymentMode } from '../types';

export const generateSalariesSchema = z.object({
    body: z.object({
        month: z.string().min(1, 'Month is required'),
        year: z.number().int().min(2000).max(2100),
        specificStaffId: z.string().optional(),
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

export const upsertSalaryStructureSchema = z.object({
    body: z.object({
        baseSalary: z.number().min(0, 'Base salary must be non-negative'),
        allowances: z
            .array(z.object({
                title: z.string().min(1),
                amount: z.number().min(0),
            }))
            .optional()
            .default([]),
        deductions: z
            .array(z.object({
                title: z.string().min(1),
                amount: z.number().min(0),
            }))
            .optional()
            .default([]),
        effectiveFrom: z.union([z.string(), z.date()]).optional().transform((v) => (v ? new Date(v) : undefined)),
    }),
    params: z.object({
        staffId: z.string().min(1),
    }).partial().optional(),
});

export const createOtherPaymentSchema = z.object({
    body: z.object({
        title: z.string().min(1, 'Title is required'),
        amount: z.number().positive('Amount must be positive'),
        type: z.enum(['bonus', 'adjustment']),
        date: z.union([z.string(), z.coerce.date()]),
        notes: z.string().optional(),
    }),
});
