import { Schema, model, Model } from 'mongoose';
import { IFeePayment } from '../types';

interface IFeePaymentModel extends Model<IFeePayment> { }

const feePaymentSchema = new Schema<IFeePayment, IFeePaymentModel>(
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
        classId: {
            type: Schema.Types.ObjectId,
            ref: 'Class',
        },
        receiptNumber: {
            type: String,
            required: true,
            trim: true,
        },
        amountPaid: {
            type: Number,
            required: true,
            min: 0,
        },
        paymentMode: {
            type: String,
            required: true,
            enum: ['cash', 'upi', 'bank', 'cheque', 'card', 'online'],
        },
        paymentDate: {
            type: Date,
            required: true,
            default: Date.now,
        },
        previousDue: {
            type: Number,
            required: true,
            default: 0,
        },
        remainingDue: {
            type: Number,
            required: true,
            default: 0,
        },
        pdfPath: {
            type: String,
            trim: true,
        },
        transactionId: {
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

feePaymentSchema.index({ receiptNumber: 1 }, { unique: true });
feePaymentSchema.index({ schoolId: 1, receiptNumber: 1 });
feePaymentSchema.index({ schoolId: 1, studentId: 1 });
feePaymentSchema.index({ schoolId: 1, paymentDate: 1 });

const FeePayment = model<IFeePayment, IFeePaymentModel>('FeePayment', feePaymentSchema);

export default FeePayment;
