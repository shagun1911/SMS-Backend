import { Schema, model, Document } from 'mongoose';

export interface IBus extends Document {
    schoolId: Schema.Types.ObjectId;
    busNumber: string;
    registrationNumber: string;
    routeName: string;
    capacity: number;
    driverId?: Schema.Types.ObjectId;
    driverName?: string;
    driverPhone?: string;
    conductorName?: string;
    conductorPhone?: string;
    isActive: boolean;
}

const busSchema = new Schema<IBus>(
    {
        schoolId: {
            type: Schema.Types.ObjectId,
            ref: 'School',
            required: true,
        },
        busNumber: {
            type: String,
            required: true,
            trim: true,
            uppercase: true,
        },
        registrationNumber: {
            type: String,
            required: true,
            trim: true,
            uppercase: true,
        },
        routeName: {
            type: String,
            required: true,
            trim: true,
        },
        capacity: {
            type: Number,
            required: true,
            min: 1,
        },
        driverId: {
            type: Schema.Types.ObjectId,
            ref: 'Driver',
        },
        driverName: {
            type: String,
            trim: true,
        },
        driverPhone: {
            type: String,
            trim: true,
        },
        conductorName: {
            type: String,
            trim: true,
        },
        conductorPhone: {
            type: String,
            trim: true,
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

// Unique bus per school
busSchema.index({ schoolId: 1, busNumber: 1 }, { unique: true });
busSchema.index({ schoolId: 1, registrationNumber: 1 }, { unique: true });

const Bus = model<IBus>('Bus', busSchema);

export default Bus;
