import { Schema, model, Document, Types } from 'mongoose';

export enum AttendanceStatus {
    PRESENT = 'present',
    ABSENT = 'absent',
    LATE = 'late',
    HALF_DAY = 'half_day'
}

export interface IAttendance extends Document {
    schoolId: Types.ObjectId;
    studentId: Types.ObjectId;
    date: Date;
    status: AttendanceStatus;
    remarks?: string;
    takenBy: Types.ObjectId;
}

const attendanceSchema = new Schema<IAttendance>(
    {
        schoolId: {
            type: Schema.Types.ObjectId,
            ref: 'School',
            required: true,
            index: true,
        },
        studentId: {
            type: Schema.Types.ObjectId,
            ref: 'Student',
            required: true,
            index: true,
        },
        date: {
            type: Date,
            required: true,
            index: true,
        },
        status: {
            type: String,
            enum: Object.values(AttendanceStatus),
            default: AttendanceStatus.PRESENT,
        },
        remarks: {
            type: String,
            trim: true,
        },
        takenBy: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
    },
    {
        timestamps: true,
    }
);

// Ensure one attendance record per student per day
attendanceSchema.index({ studentId: 1, date: 1 }, { unique: true });

const Attendance = model<IAttendance>('Attendance', attendanceSchema);

export default Attendance;
