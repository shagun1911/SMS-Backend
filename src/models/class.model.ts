import { Schema, model, Model, Document, Types } from 'mongoose';

export interface IClass extends Document {
    _id: Types.ObjectId;
    schoolId: Types.ObjectId;
    className: string; // "I", "II", "III", "IV", "V", ...
    section: string;   // "A", "B", "C" – one document per (className, section)
    classTeacherId?: Types.ObjectId;
    roomNumber?: string;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
}

interface IClassModel extends Model<IClass> { }

const classSchema = new Schema<IClass, IClassModel>(
    {
        schoolId: {
            type: Schema.Types.ObjectId,
            ref: 'School',
            required: true,
        },
        className: {
            type: String,
            required: true,
            trim: true,
        },
        section: {
            type: String,
            required: true,
            trim: true,
            uppercase: true,
        },
        classTeacherId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
        },
        roomNumber: {
            type: String,
            trim: true,
        },
        isActive: {
            type: Boolean,
            default: true,
        },
    },
    {
        timestamps: true,
    }
);

classSchema.index({ schoolId: 1, className: 1, section: 1 }, { unique: true });

const Class = model<IClass, IClassModel>('Class', classSchema);

export default Class;
