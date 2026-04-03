import { Schema, model, Model } from 'mongoose';
import { IReceiptCounter } from '../types';

interface IReceiptCounterModel extends Model<IReceiptCounter> {}

const receiptCounterSchema = new Schema<IReceiptCounter, IReceiptCounterModel>(
    {
        schoolId: {
            type: Schema.Types.ObjectId,
            ref: 'School',
            required: true,
        },
        year: {
            type: Number,
            required: true,
        },
        seq: {
            type: Number,
            required: true,
            default: 0,
        },
    },
    { timestamps: true }
);

receiptCounterSchema.index({ schoolId: 1, year: 1 }, { unique: true });

const ReceiptCounter = model<IReceiptCounter, IReceiptCounterModel>('ReceiptCounter', receiptCounterSchema);

export default ReceiptCounter;
