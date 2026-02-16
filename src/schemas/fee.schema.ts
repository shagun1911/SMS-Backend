import { z } from 'zod';
import { FeeType, PaymentMode } from '../types';

const feeComponentSchema = z.object({
    name: z.string().min(1, 'Component name is required'),
    amount: z.number().min(0, 'Amount must be non-negative'),
    type: z.enum(['monthly', 'one-time']).default('monthly'),
});

export const createFeeStructureSchema = z.object({
    body: z.object({
        classId: z.string().optional(),
        class: z.string().min(1, 'Class is required'),
        components: z.array(feeComponentSchema).optional(),
        fees: z.array(z.object({
            title: z.string().min(1, 'Fee title is required'),
            type: z.nativeEnum(FeeType),
            amount: z.number().positive('Amount must be positive'),
            isOptional: z.boolean().default(false),
            description: z.string().optional(),
        })).optional(),
        totalAnnualFee: z.number().min(0).optional(),
    }).refine((b) => ((b.components?.length ?? 0) >= 1) || ((b.fees?.length ?? 0) >= 1), { message: 'Add at least one fee component or fee item' }),
});

export const updateFeeStructureSchema = z.object({
    body: z.object({
        class: z.string().min(1).optional(),
        components: z.array(feeComponentSchema).min(1).optional(),
        totalAmount: z.number().min(0).optional(),
    }),
});

export const payFeeSchema = z.object({
    body: z.object({
        studentId: z.string().min(1, 'Student ID is required'),
        amountPaid: z.number().positive('Payment amount must be positive'),
        paymentMode: z.enum(['cash', 'upi', 'bank', 'cheque', 'card', 'online']),
        paymentDate: z.string().optional(),
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
