import { Schema, model, Document, Types } from 'mongoose';

export interface IUserNotification extends Document {
    _id: Types.ObjectId;
    userId: Types.ObjectId;
    schoolId: Types.ObjectId;
    title: string;
    message: string;
    isRead: boolean;
    type: string;
    metadata?: Record<string, any>;
    createdAt: Date;
    updatedAt: Date;
}

const userNotificationSchema = new Schema<IUserNotification>(
    {
        userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        schoolId: { type: Schema.Types.ObjectId, ref: 'School', required: true },
        title: { type: String, required: true, trim: true },
        message: { type: String, required: true },
        isRead: { type: Boolean, default: false },
        type: { type: String, required: true, default: 'general' },
        metadata: { type: Schema.Types.Mixed }, // flexible JSON for extra context
    },
    { timestamps: true }
);

// Index for fast query of a user's unread / recent notifications
userNotificationSchema.index({ userId: 1, isRead: 1, createdAt: -1 });

export default model<IUserNotification>('UserNotification', userNotificationSchema);
