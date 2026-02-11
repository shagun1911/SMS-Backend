import { Schema, model, Model } from 'mongoose';
import { ISalaryRecord, SalaryStatus, PaymentMode } from '../types';

interface ISalaryModel extends Model<ISalaryRecord> { }

const salarySchema = new Schema<ISalaryRecord, ISalaryModel>(
    {
        schoolId: {
            type: Schema.Types.ObjectId,
            ref: 'School',
            required: true,
            index: true,
        },
        staffId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        month: {
            type: String, // e.g., "April-2024"
            required: true,
        },
        year: {
            type: Number,
            required: true,
        },
        basicSalary: {
            type: Number,
            required: true,
            min: 0,
        },
        allowances: [
            {
                title: { type: String, required: true },
                amount: { type: Number, required: true, min: 0 },
            },
        ],
        deductions: [
            {
                title: { type: String, required: true },
                amount: { type: Number, required: true, min: 0 },
            },
        ],
        totalSalary: {
            type: Number,
            required: true,
        },
        netSalary: {
            type: Number,
            required: true,
        },
        status: {
            type: String,
            enum: Object.values(SalaryStatus),
            default: SalaryStatus.PENDING,
            index: true,
        },
        paymentDate: {
            type: Date,
        },
        paymentMode: {
            type: String,
            enum: Object.values(PaymentMode),
        },
        transactionId: {
            type: String,
            trim: true,
        },
        remarks: {
            type: String,
            trim: true,
        },
    },
    {
        timestamps: true,
        toJSON: { virtuals: true },
        toObject: { virtuals: true },
    }
);

// Indexes
// Prevent duplicate salary record for same staff in same month
salarySchema.index({ schoolId: 1, staffId: 1, month: 1, year: 1 }, { unique: true });

const Salary = model<ISalaryRecord, ISalaryModel>('Salary', salarySchema);

export default Salary;
