import { Schema, model, Model } from 'mongoose';
import { ISalaryStructure } from '../types';

interface ISalaryStructureModel extends Model<ISalaryStructure> { }

const salaryStructureSchema = new Schema<ISalaryStructure, ISalaryStructureModel>(
    {
        schoolId: {
            type: Schema.Types.ObjectId,
            ref: 'School',
            required: true,
        },
        staffId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
        baseSalary: {
            type: Number,
            required: true,
            min: 0,
        },
        allowances: [
            {
                title: { type: String, required: true, trim: true },
                amount: { type: Number, required: true, min: 0 },
            },
        ],
        deductions: [
            {
                title: { type: String, required: true, trim: true },
                amount: { type: Number, required: true, min: 0 },
            },
        ],
        effectiveFrom: {
            type: Date,
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

// One active structure per staff per school
salaryStructureSchema.index({ schoolId: 1, staffId: 1, isActive: 1 });

const SalaryStructure = model<ISalaryStructure, ISalaryStructureModel>('SalaryStructure', salaryStructureSchema);

export default SalaryStructure;

