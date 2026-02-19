import { Schema, model, Model } from 'mongoose';
import { IOtherPayment } from '../types';

interface IOtherPaymentModel extends Model<IOtherPayment> { }

const otherPaymentSchema = new Schema<IOtherPayment, IOtherPaymentModel>(
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
        title: {
            type: String,
            required: true,
            trim: true,
        },
        amount: {
            type: Number,
            required: true,
            min: 0,
        },
        type: {
            type: String,
            enum: ['bonus', 'adjustment'],
            required: true,
        },
        date: {
            type: Date,
            required: true,
        },
        notes: {
            type: String,
            trim: true,
        },
    },
    {
        timestamps: true,
    }
);

otherPaymentSchema.index({ schoolId: 1, staffId: 1, date: 1 });

const OtherPayment = model<IOtherPayment, IOtherPaymentModel>('OtherPayment', otherPaymentSchema);

export default OtherPayment;

