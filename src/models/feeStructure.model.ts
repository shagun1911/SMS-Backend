import { Schema, model, Model } from 'mongoose';
import { IFeeStructure, FeeType } from '../types';

interface IFeeStructureModel extends Model<IFeeStructure> { }

const feeStructureSchema = new Schema<IFeeStructure, IFeeStructureModel>(
    {
        schoolId: {
            type: Schema.Types.ObjectId,
            ref: 'School',
            required: true,
            index: true,
        },
        sessionId: {
            type: Schema.Types.ObjectId,
            ref: 'Session',
            required: true,
            index: true,
        },
        classId: {
            type: Schema.Types.ObjectId,
            ref: 'Class',
        },
        class: {
            type: String,
            required: true,
            trim: true,
        },
        fees: [
            {
                title: { type: String, required: true },
                type: {
                    type: String,
                    enum: Object.values(FeeType),
                    required: true,
                },
                amount: { type: Number, required: true, min: 0 },
                description: String,
                isOptional: { type: Boolean, default: false },
            },
        ],
        components: [
            {
                name: { type: String, required: true },
                amount: { type: Number, required: true, min: 0 },
                type: { type: String, enum: ['monthly', 'one-time'], default: 'monthly' },
            },
        ],
        totalAnnualFee: {
            type: Number,
            default: 0,
        },
        totalAmount: {
            type: Number,
            default: 0,
        },
        isActive: {
            type: Boolean,
            default: true,
        },
    },
    {
        timestamps: true,
        toJSON: { virtuals: true },
        toObject: { virtuals: true },
    }
);

// Helper: annual contribution of one component (monthly → ×12, one-time → as-is)
function componentAnnualAmount(c: { amount: number; type?: string }): number {
    return (c.type === 'one-time') ? c.amount : (c.amount * 12);
}

// Pre-save hook to calculate total from components or fees
feeStructureSchema.pre('save', function (next) {
    if (this.components && this.components.length > 0) {
        const total = this.components.reduce((acc, curr) => acc + componentAnnualAmount(curr), 0);
        this.totalAmount = total;
        this.totalAnnualFee = total;
    } else if (this.fees && this.fees.length > 0) {
        this.totalAnnualFee = this.fees.reduce((acc, curr) => acc + curr.amount, 0);
        if (this.totalAmount === undefined || this.totalAmount === 0) {
            this.totalAmount = this.totalAnnualFee;
        }
    }
    next();
});

// Compounds
feeStructureSchema.index({ schoolId: 1, sessionId: 1, class: 1 }, { unique: true });
feeStructureSchema.index({ schoolId: 1, isActive: 1 });

const FeeStructure = model<IFeeStructure, IFeeStructureModel>('FeeStructure', feeStructureSchema);

export default FeeStructure;
