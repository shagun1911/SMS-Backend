import { Schema, model, Model } from 'mongoose';
import { IStudentFee, FeeStatus, PaymentMode } from '../types';

interface IStudentFeeModel extends Model<IStudentFee> { }

const studentFeeSchema = new Schema<IStudentFee, IStudentFeeModel>(
    {
        schoolId: {
            type: Schema.Types.ObjectId,
            ref: 'School',
            required: true,
        },
        studentId: {
            type: Schema.Types.ObjectId,
            ref: 'Student',
            required: true,
        },
        sessionId: {
            type: Schema.Types.ObjectId,
            ref: 'Session',
            required: true,
        },
        month: {
            type: String, // e.g., "April", "May" or "One-Time"
            required: true,
        },
        feeBreakdown: [
            {
                title: String,
                amount: Number,
                type: String,
            },
        ],
        totalAmount: {
            type: Number,
            required: true,
            min: 0,
        },
        paidAmount: {
            type: Number,
            default: 0,
        },
        remainingAmount: {
            type: Number,
            default: 0,
        },
        status: {
            type: String,
            enum: Object.values(FeeStatus),
            default: FeeStatus.PENDING,
        },
        dueDate: {
            type: Date,
            required: true,
        },
        payments: [
            {
                amount: { type: Number, required: true },
                paymentDate: { type: Date, default: Date.now },
                paymentMode: {
                    type: String,
                    enum: Object.values(PaymentMode),
                    required: true,
                },
                transactionId: { type: String, trim: true },
                receiptNumber: { type: String, trim: true },
                receivedBy: {
                    type: Schema.Types.ObjectId,
                    ref: 'User',
                    required: true,
                },
                remarks: String,
            },
        ],
        discount: {
            type: Number,
            default: 0,
        },
        discountReason: String,
        lateFee: {
            type: Number,
            default: 0,
        },
    },
    {
        timestamps: true,
        toJSON: { virtuals: true },
        toObject: { virtuals: true },
    }
);

// Indexes
// Optimize query for pending fees
studentFeeSchema.index({ schoolId: 1, status: 1 });
// Ensure unique monthly/fee record per student
studentFeeSchema.index({ schoolId: 1, studentId: 1, sessionId: 1, month: 1 }, { unique: true });

// Pre-save hook to calculate remaining amount & update status
studentFeeSchema.pre('save', function (next) {
    // Calculate remaining
    const total = this.totalAmount + this.lateFee - this.discount;
    this.remainingAmount = total - this.paidAmount;

    // Determine status
    if (this.paidAmount === 0) {
        this.status = FeeStatus.PENDING;
    } else if (this.paidAmount >= total) {
        this.status = FeeStatus.PAID;
        this.remainingAmount = 0; // Prevent negative remaining
    } else {
        this.status = FeeStatus.PARTIAL;
    }

    // Check for overdue (only if not paid)
    if (this.status !== FeeStatus.PAID && new Date() > this.dueDate) {
        this.status = FeeStatus.OVERDUE;
    }

    next();
});

const StudentFee = model<IStudentFee, IStudentFeeModel>('StudentFee', studentFeeSchema);

export default StudentFee;
