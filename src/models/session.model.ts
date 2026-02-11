import { Schema, model, Model } from 'mongoose';
import { ISession } from '../types';

interface ISessionModel extends Model<ISession> { }

const sessionSchema = new Schema<ISession, ISessionModel>(
    {
        schoolId: {
            type: Schema.Types.ObjectId,
            ref: 'School',
            required: true,
            index: true,
        },
        sessionYear: {
            type: String, // e.g., "2024-2025"
            required: true,
            trim: true,
        },
        startDate: {
            type: Date,
            required: true,
        },
        endDate: {
            type: Date,
            required: true,
        },
        isActive: {
            type: Boolean,
            default: false,
        },
        promotionCompleted: {
            type: Boolean,
            default: false,
        },
        promotionDate: {
            type: Date,
            default: null,
        },
    },
    {
        timestamps: true,
        toJSON: { virtuals: true },
        toObject: { virtuals: true },
    }
);

// Indexes
sessionSchema.index({ schoolId: 1, sessionYear: 1 }, { unique: true });
sessionSchema.index({ schoolId: 1, isActive: 1 });

const Session = model<ISession, ISessionModel>('Session', sessionSchema);

export default Session;
