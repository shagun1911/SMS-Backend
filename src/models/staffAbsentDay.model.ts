import { Schema, model, Document, Types } from 'mongoose';

/** One document per staff member per calendar day when they are absent (present days are not stored). */
export interface IStaffAbsentDay extends Document {
    schoolId: Types.ObjectId;
    staffId: Types.ObjectId;
    /** YYYY-MM-DD */
    date: string;
    markedBy?: Types.ObjectId;
    createdAt?: Date;
    updatedAt?: Date;
}

const staffAbsentDaySchema = new Schema<IStaffAbsentDay>(
    {
        schoolId: {
            type: Schema.Types.ObjectId,
            ref: 'School',
            required: true,
            index: true,
        },
        staffId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        date: {
            type: String,
            required: true,
            trim: true,
            match: /^\d{4}-\d{2}-\d{2}$/,
        },
        markedBy: {
            type: Schema.Types.ObjectId,
            ref: 'User',
        },
    },
    { timestamps: true }
);

staffAbsentDaySchema.index({ schoolId: 1, staffId: 1, date: 1 }, { unique: true });
staffAbsentDaySchema.index({ schoolId: 1, date: 1 });

export default model<IStaffAbsentDay>('StaffAbsentDay', staffAbsentDaySchema);
