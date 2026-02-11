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
        totalAnnualFee: {
            type: Number,
            required: true,
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

// Pre-save hook to calculate total annual fee if not provided
feeStructureSchema.pre('save', function (next) {
    if (this.isModified('fees')) {
        this.totalAnnualFee = this.fees.reduce((acc, curr) => acc + curr.amount, 0);
    }
    next();
});

// Compounds
feeStructureSchema.index({ schoolId: 1, sessionId: 1, class: 1 }, { unique: true });
feeStructureSchema.index({ schoolId: 1, isActive: 1 });

const FeeStructure = model<IFeeStructure, IFeeStructureModel>('FeeStructure', feeStructureSchema);

export default FeeStructure;
