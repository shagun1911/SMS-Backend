import { Schema, model, Document, Types } from 'mongoose';

export interface INotification extends Document {
    _id: Types.ObjectId;
    schoolId: Types.ObjectId;
    type: 'sms' | 'email';
    subject?: string;
    message: string;
    targetGroup: 'all' | 'defaulters' | 'custom';
    recipientCount: number;
    sentCount: number;
    failedCount: number;
    status: 'pending' | 'sending' | 'completed' | 'failed';
    createdBy: Types.ObjectId;
    createdAt: Date;
    updatedAt: Date;
}

const notificationSchema = new Schema<INotification>(
    {
        schoolId: { type: Schema.Types.ObjectId, ref: 'School', required: true },
        type: { type: String, enum: ['sms', 'email'], required: true },
        subject: { type: String, trim: true },
        message: { type: String, required: true },
        targetGroup: { type: String, enum: ['all', 'defaulters', 'custom'], required: true },
        recipientCount: { type: Number, default: 0 },
        sentCount: { type: Number, default: 0 },
        failedCount: { type: Number, default: 0 },
        status: { type: String, enum: ['pending', 'sending', 'completed', 'failed'], default: 'pending' },
        createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    },
    { timestamps: true }
);

notificationSchema.index({ schoolId: 1, createdAt: -1 });

export default model<INotification>('Notification', notificationSchema);
