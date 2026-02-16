import { Schema, model, Document, Types } from 'mongoose';

export interface ITimetableSlotSnapshot {
    startTime: string;
    endTime: string;
    subject?: string;
    teacherId?: Types.ObjectId;
    teacherName?: string;
    type: string;
    title?: string;
}

export interface ITimetableVersion extends Document {
    schoolId: Types.ObjectId;
    className: string;
    section: string;
    version: number;
    days: { dayOfWeek: number; slots: ITimetableSlotSnapshot[] }[];
    isLocked: boolean;
    createdAt: Date;
    updatedAt: Date;
}

const slotSnapshotSchema = new Schema({
    startTime: String,
    endTime: String,
    subject: String,
    teacherId: Schema.Types.ObjectId,
    teacherName: String,
    type: String,
    title: String,
}, { _id: false });

const timetableVersionSchema = new Schema<ITimetableVersion>(
    {
        schoolId: { type: Schema.Types.ObjectId, ref: 'School', required: true, index: true },
        className: { type: String, required: true, index: true },
        section: { type: String, required: true, default: 'A', index: true },
        version: { type: Number, required: true, default: 1 },
        days: [{
            dayOfWeek: Number,
            slots: [slotSnapshotSchema],
        }],
        isLocked: { type: Boolean, default: false },
    },
    { timestamps: true }
);

timetableVersionSchema.index({ schoolId: 1, className: 1, section: 1, version: -1 });

const TimetableVersion = model<ITimetableVersion>('TimetableVersion', timetableVersionSchema);
export default TimetableVersion;
