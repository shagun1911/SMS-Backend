import { Schema, model, Document, Types } from 'mongoose';

export interface ITimetableCell {
    subject?: string;
    teacherId?: Types.ObjectId;
}

export interface ITimetableGridRow {
    className: string;
    section?: string; // one row per (className, section)
    cells: ITimetableCell[];
}

export interface ISchoolTimetableGrid extends Document {
    schoolId: Types.ObjectId;
    sessionId?: Types.ObjectId;
    rows: ITimetableGridRow[];
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
}

const cellSchema = new Schema({
    subject: { type: String, trim: true },
    teacherId: { type: Schema.Types.ObjectId, ref: 'User' },
}, { _id: false });

const rowSchema = new Schema({
    className: { type: String, required: true, trim: true },
    section: { type: String, trim: true, uppercase: true },
    cells: [cellSchema],
}, { _id: false });

const schoolTimetableGridSchema = new Schema<ISchoolTimetableGrid>(
    {
        schoolId: { type: Schema.Types.ObjectId, ref: 'School', required: true, unique: true },
        sessionId: { type: Schema.Types.ObjectId, ref: 'Session' },
        rows: [rowSchema],
        isActive: { type: Boolean, default: true },
    },
    { timestamps: true }
);

const SchoolTimetableGrid = model<ISchoolTimetableGrid>('SchoolTimetableGrid', schoolTimetableGridSchema);
export default SchoolTimetableGrid;
