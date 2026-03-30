import { Schema, model, Document, Types } from 'mongoose';

export interface IStudentNotification extends Document {
    studentId: Types.ObjectId;
    schoolId: Types.ObjectId;
    title: string;
    message: string;
    isRead: boolean;
    type: string;
    metadata?: Record<string, unknown>;
}

const studentNotificationSchema = new Schema<IStudentNotification>(
    {
        studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true, index: true },
        schoolId: { type: Schema.Types.ObjectId, ref: 'School', required: true },
        title: { type: String, required: true, trim: true },
        message: { type: String, required: true },
        isRead: { type: Boolean, default: false },
        type: { type: String, required: true, default: 'general' },
        metadata: { type: Schema.Types.Mixed },
    },
    { timestamps: true }
);

studentNotificationSchema.index({ studentId: 1, isRead: 1, createdAt: -1 });

export default model<IStudentNotification>('StudentNotification', studentNotificationSchema);
