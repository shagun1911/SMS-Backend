import { Schema, model, Document, Types } from 'mongoose';

export interface ITimetableBreakSlot {
    afterPeriod: number;
    label: string;
    durationMinutes: number;
}

/** Per-class override — if present, takes precedence over global settings for that class. */
export interface IClassTimetableSetting {
    className: string;
    section: string;
    periodCount: number;
    periodDurationMinutes: number;
    firstPeriodStart: string;
    breaks: ITimetableBreakSlot[];
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
    /** Working days for this school e.g. ["Mon","Tue","Wed","Thu","Fri","Sat"].
     *  Default: Mon–Sat (backward compat). dayOfWeek mapping: Sun=0, Mon=1…Sat=6. */
    workingDays: string[];
    /** Optional per-class overrides for period count, duration, start time and breaks. */
    classSettings?: IClassTimetableSetting[];
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
}

const breakSlotSchema = new Schema<ITimetableBreakSlot>({
    afterPeriod: { type: Number, required: true, min: 0, max: 12 },
    label: { type: String, required: true, trim: true, maxlength: 40 },
    durationMinutes: { type: Number, required: true, min: 5, max: 120 },
}, { _id: false });

const classSettingSchema = new Schema<IClassTimetableSetting>({
    className: { type: String, required: true, trim: true },
    section: { type: String, required: true, trim: true, uppercase: true },
    periodCount: { type: Number, required: true, min: 1, max: 12 },
    periodDurationMinutes: { type: Number, required: true, min: 10, max: 120 },
    firstPeriodStart: { type: String, required: true, trim: true },
    breaks: [breakSlotSchema],
}, { _id: false });

const ALL_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

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
        breaks: [breakSlotSchema],
        subjects: [{ type: String, trim: true }],
        workingDays: {
            type: [String],
            enum: ALL_DAYS,
            default: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
        },
        classSettings: { type: [classSettingSchema], default: [] },
        isActive: { type: Boolean, default: true },
    },
    { timestamps: true }
);

timetableSettingsSchema.index({ schoolId: 1, sessionId: 1 }, { unique: true, sparse: true });

const TimetableSettings = model<ITimetableSettings>('TimetableSettings', timetableSettingsSchema);
export default TimetableSettings;
