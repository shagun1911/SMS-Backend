import { Schema, model, Model } from 'mongoose';

/** Feature keys that can be toggled per plan. Schools only get access to features in their plan's enabledFeatures. */
export const PLAN_FEATURE_KEYS = [
    'dashboard', 'students', 'classes', 'sessions', 'fees', 'staff', 'transport', 'exams', 'admit_cards', 'timetable', 'ai', 'reports', 'plan_billing',
] as const;
export type PlanFeatureKey = typeof PLAN_FEATURE_KEYS[number];

export interface IPlan {
    name: string;
    description?: string;
    maxStudents: number;
    maxTeachers: number;
    priceMonthly: number;
    priceYearly: number;
    features: string[];
    /** Which app features this plan allows. If missing/empty, treat as all enabled for backward compatibility. */
    enabledFeatures?: string[];
    isActive: boolean;
    /** Stripe Price ID for monthly (optional; if not set, price is used via price_data) */
    stripePriceIdMonthly?: string;
    /** Stripe Price ID for yearly (optional) */
    stripePriceIdYearly?: string;
    isDefault?: boolean;
    /** Number of days for free trial (0 = no trial). */
    trialDays?: number;
    createdAt: Date;
    updatedAt: Date;
}

interface IPlanModel extends Model<IPlan> {}

const planSchema = new Schema<IPlan, IPlanModel>(
    {
        name: { type: String, required: true, trim: true },
        description: { type: String, trim: true },
        maxStudents: { type: Number, required: true, min: 0 },
        maxTeachers: { type: Number, required: true, min: 0 },
        priceMonthly: { type: Number, required: true, min: 0 },
        priceYearly: { type: Number, required: true, min: 0 },
        features: [{ type: String, trim: true }],
        enabledFeatures: [{ type: String, trim: true }],
        isActive: { type: Boolean, default: true },
        stripePriceIdMonthly: { type: String, trim: true },
        stripePriceIdYearly: { type: String, trim: true },
        isDefault: { type: Boolean, default: false },
        trialDays: { type: Number, default: 0 },
    },
    { timestamps: true }
);

export default model<IPlan, IPlanModel>('Plan', planSchema);
