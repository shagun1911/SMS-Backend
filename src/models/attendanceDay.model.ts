import { Schema, model, Document, Types } from 'mongoose';

export interface IAttendanceDay extends Document {
    schoolId: Types.ObjectId;
    classId: Types.ObjectId;
    /** YYYY-MM-DD (calendar date from client / server agreement) */
    date: string;
    absentStudentIds: Types.ObjectId[];
    markedBy: Types.ObjectId;
    createdAt?: Date;
    updatedAt?: Date;
}

const attendanceDaySchema = new Schema<IAttendanceDay>(
    {
        schoolId: {
            type: Schema.Types.ObjectId,
            ref: 'School',
            required: true,
            index: true,
        },
        classId: {
            type: Schema.Types.ObjectId,
            ref: 'Class',
            required: true,
        },
        date: {
            type: String,
            required: true,
            trim: true,
            match: /^\d{4}-\d{2}-\d{2}$/,
        },
        absentStudentIds: {
            type: [{ type: Schema.Types.ObjectId, ref: 'Student' }],
            default: [],
        },
        markedBy: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
    },
    { timestamps: true }
);

attendanceDaySchema.index({ schoolId: 1, classId: 1, date: 1 }, { unique: true });

export default model<IAttendanceDay>('AttendanceDay', attendanceDaySchema);
