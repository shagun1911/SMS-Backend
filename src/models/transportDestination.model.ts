import { Schema, model, Document } from 'mongoose';

export interface ITransportDestination extends Document {
    schoolId: Schema.Types.ObjectId;
    destinationName: string;
    monthlyFee: number;
    isActive: boolean;
}

const transportDestinationSchema = new Schema<ITransportDestination>(
    {
        schoolId: {
            type: Schema.Types.ObjectId,
            ref: 'School',
            required: true,
        },
        destinationName: {
            type: String,
            required: true,
            trim: true,
        },
        monthlyFee: {
            type: Number,
            required: true,
            min: 0,
        },
        isActive: {
            type: Boolean,
            default: true,
        },
    },
    {
        timestamps: true,
    }
);

// Unique destination per school
transportDestinationSchema.index({ schoolId: 1, destinationName: 1 }, { unique: true });

const TransportDestination = model<ITransportDestination>('TransportDestination', transportDestinationSchema);

export default TransportDestination;
