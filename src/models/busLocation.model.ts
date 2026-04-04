import { Schema, model, Document, Types } from 'mongoose';

export interface IBusLocation extends Document {
    busId: Types.ObjectId;
    lat: number;
    lng: number;
    accuracy?: number;
    updatedBy?: Types.ObjectId;
    updatedAt: Date;
}

const busLocationSchema = new Schema<IBusLocation>(
    {
        busId: {
            type: Schema.Types.ObjectId,
            ref: 'Bus',
            required: true,
            unique: true,
        },
        lat: { type: Number, required: true },
        lng: { type: Number, required: true },
        accuracy: { type: Number },
        updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    },
    {
        timestamps: { createdAt: false, updatedAt: true },
    }
);

busLocationSchema.index({ busId: 1 });

const BusLocation = model<IBusLocation>('BusLocation', busLocationSchema);

export default BusLocation;
