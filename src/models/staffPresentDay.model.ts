import { Schema, model, Document, Types } from 'mongoose';

/** Explicit present mark for a calendar day (pending vs present vs absent workflow). */
export interface IStaffPresentDay extends Document {
    schoolId: Types.ObjectId;
    staffId: Types.ObjectId;
    /** YYYY-MM-DD */
    date: string;
    markedBy?: Types.ObjectId;
    createdAt?: Date;
    updatedAt?: Date;
}

const staffPresentDaySchema = new Schema<IStaffPresentDay>(
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

staffPresentDaySchema.index({ schoolId: 1, staffId: 1, date: 1 }, { unique: true });
staffPresentDaySchema.index({ schoolId: 1, date: 1 });

export default model<IStaffPresentDay>('StaffPresentDay', staffPresentDaySchema);
