import { Schema, model, Model } from 'mongoose';
import { ISalaryRecord, SalaryStatus, PaymentMode } from '../types';

interface ISalaryModel extends Model<ISalaryRecord> { }

const salarySchema = new Schema<ISalaryRecord, ISalaryModel>(
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
        paidAmount: {
            type: Number,
            default: 0,
        },
        status: {
            type: String,
            enum: Object.values(SalaryStatus),
            default: SalaryStatus.PENDING,
        },
        paymentDate: {
            type: Date,
        },
        paymentMode: {
            type: String,
            enum: Object.values(PaymentMode),
        },
        paymentHistory: [
            {
                amount: { type: Number, required: true },
                paymentDate: { type: Date, required: true },
                paymentMode: { type: String, enum: Object.values(PaymentMode), required: true },
                transactionId: { type: String },
                remarks: { type: String },
            }
        ],
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
// Optimize monthly payroll summary queries
salarySchema.index({ schoolId: 1, month: 1, year: 1 });

const Salary = model<ISalaryRecord, ISalaryModel>('Salary', salarySchema);

export default Salary;
