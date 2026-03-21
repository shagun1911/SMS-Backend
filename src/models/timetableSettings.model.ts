import { Schema, model, Document, Types } from 'mongoose';

export interface ITimetableBreakSlot {
    afterPeriod: number;
    label: string;
    durationMinutes: number;
}

export interface ITimetableSettings extends Document {
    schoolId: Types.ObjectId;
    sessionId?: Types.ObjectId;
    periodCount: number;
    lunchAfterPeriod: number;
    firstPeriodStart: string;
    periodDurationMinutes: number;
    lunchBreakDuration: number;
    breakLabel: string;
    /** Multiple breaks in order; when empty, legacy lunch* + breakLabel apply */
    breaks?: ITimetableBreakSlot[];
    subjects: string[];
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
}

const timetableSettingsSchema = new Schema<ITimetableSettings>(
    {
        schoolId: { type: Schema.Types.ObjectId, ref: 'School', required: true },
        sessionId: { type: Schema.Types.ObjectId, ref: 'Session' },
        periodCount: { type: Number, required: true, default: 7, min: 1, max: 12 },
        lunchAfterPeriod: { type: Number, required: true, default: 4, min: 0, max: 12 },
        firstPeriodStart: { type: String, default: '08:00', trim: true },
        periodDurationMinutes: { type: Number, default: 40, min: 30, max: 60 },
        lunchBreakDuration: { type: Number, default: 40, min: 5, max: 120 },
        breakLabel: { type: String, default: 'Lunch Break', trim: true, maxlength: 40 },
        breaks: [
            {
                afterPeriod: { type: Number, required: true, min: 0, max: 12 },
                label: { type: String, required: true, trim: true, maxlength: 40 },
                durationMinutes: { type: Number, required: true, min: 5, max: 120 },
            },
        ],
        subjects: [{ type: String, trim: true }],
        isActive: { type: Boolean, default: true },
    },
    { timestamps: true }
);

timetableSettingsSchema.index({ schoolId: 1, sessionId: 1 }, { unique: true, sparse: true });

const TimetableSettings = model<ITimetableSettings>('TimetableSettings', timetableSettingsSchema);
export default TimetableSettings;
