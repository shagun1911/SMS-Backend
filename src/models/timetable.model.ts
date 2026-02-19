import { Schema, model, Document, Types } from 'mongoose';

export interface ITimetableSlot {
    startTime: string;  // "09:00"
    endTime: string;    // "09:45"
    subject?: string;
    teacherId?: Types.ObjectId;
    type: 'period' | 'break' | 'lunch' | 'assembly';
    title?: string;
}

export interface ITimetable extends Document {
    schoolId: Types.ObjectId;
    sessionId?: Types.ObjectId;
    className: string;
    section: string;
    dayOfWeek: number;  // 0 = Sunday, 1 = Monday, ... 5 = Friday
    slots: ITimetableSlot[];
    isActive: boolean;
}

const timetableSchema = new Schema<ITimetable>(
    {
        schoolId: { type: Schema.Types.ObjectId, ref: 'School', required: true },
        sessionId: { type: Schema.Types.ObjectId, ref: 'Session' },
        className: { type: String, required: true, trim: true },
        section: { type: String, required: true, trim: true, default: 'A' },
        dayOfWeek: { type: Number, required: true, min: 0, max: 6 },
        slots: [{
            startTime: { type: String, required: true },
            endTime: { type: String, required: true },
            subject: { type: String, trim: true },
            teacherId: { type: Schema.Types.ObjectId, ref: 'User' },
            type: { type: String, enum: ['period', 'break', 'lunch', 'assembly'], default: 'period' },
            title: { type: String, trim: true },
        }],
        isActive: { type: Boolean, default: true },
    },
    { timestamps: true }
);

timetableSchema.index({ schoolId: 1, className: 1, section: 1, dayOfWeek: 1 }, { unique: true });

const Timetable = model<ITimetable>('Timetable', timetableSchema);
export default Timetable;
