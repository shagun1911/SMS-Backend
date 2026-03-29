import { Schema, model, Document } from 'mongoose';

export interface IHomeworkAttachment {
    url: string;
    filename?: string;
    mimeType?: string;
}

export interface IHomework extends Document {
    schoolId: Schema.Types.ObjectId;
    className: string;
    section: string;
    subject: string;
    title: string;
    description: string;
    dueDate?: Date;
    createdBy: Schema.Types.ObjectId;
    /** @deprecated prefer attachments; kept for older clients */
    attachmentUrl?: string;
    attachments?: IHomeworkAttachment[];
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
}

const homeworkSchema = new Schema<IHomework>(
    {
        schoolId: { type: Schema.Types.ObjectId, ref: 'School', required: true, index: true },
        className: { type: String, required: true, trim: true },
        section: { type: String, required: true, trim: true, uppercase: true },
        subject: { type: String, required: true, trim: true },
        title: { type: String, required: true, trim: true },
        description: { type: String, required: true, trim: true },
        dueDate: { type: Date },
        createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        attachmentUrl: { type: String },
        attachments: [
            {
                url: { type: String, required: true, trim: true },
                filename: { type: String, trim: true },
                mimeType: { type: String, trim: true },
            },
        ],
        isActive: { type: Boolean, default: true },
    },
    { timestamps: true }
);

homeworkSchema.index({ schoolId: 1, className: 1, section: 1 });
homeworkSchema.index({ schoolId: 1, createdBy: 1 });

const Homework = model<IHomework>('Homework', homeworkSchema);
export default Homework;
