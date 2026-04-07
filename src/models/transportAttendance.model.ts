import { Schema, model, Document, Types } from 'mongoose';

export type TransportAttendanceStatus = 'present' | 'absent';

export interface ITransportAttendance extends Document {
    schoolId: Types.ObjectId;
    userId: Types.ObjectId;
    /** YYYY-MM-DD (IST calendar date passed by client) */
    date: string;
    status: TransportAttendanceStatus;
    markedBy?: Types.ObjectId;
    isFinal: boolean;
    createdAt?: Date;
    updatedAt?: Date;
}

const transportAttendanceSchema = new Schema<ITransportAttendance>(
    {
        schoolId: { type: Schema.Types.ObjectId, ref: 'School', required: true, index: true },
        userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
        date: { type: String, required: true, trim: true, match: /^\d{4}-\d{2}-\d{2}$/ },
        status: { type: String, enum: ['present', 'absent'], required: true },
        markedBy: { type: Schema.Types.ObjectId, ref: 'User' },
        isFinal: { type: Boolean, default: false },
    },
    { timestamps: true }
);

transportAttendanceSchema.index({ schoolId: 1, userId: 1, date: 1 }, { unique: true });
transportAttendanceSchema.index({ schoolId: 1, date: 1, isFinal: 1 });

export default model<ITransportAttendance>('TransportAttendance', transportAttendanceSchema);
