import { Schema, model, Model } from 'mongoose';

export interface IPlan {
    name: string;
    maxStudents: number;
    maxTeachers: number;
    priceMonthly: number;
    priceYearly: number;
    features: string[];
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
}

interface IPlanModel extends Model<IPlan> {}

const planSchema = new Schema<IPlan, IPlanModel>(
    {
        name: { type: String, required: true, trim: true },
        maxStudents: { type: Number, required: true, min: 0 },
        maxTeachers: { type: Number, required: true, min: 0 },
        priceMonthly: { type: Number, required: true, min: 0 },
        priceYearly: { type: Number, required: true, min: 0 },
        features: [{ type: String, trim: true }],
        isActive: { type: Boolean, default: true },
    },
    { timestamps: true }
);

export default model<IPlan, IPlanModel>('Plan', planSchema);
