import { Schema, model, Model, Document, Types } from 'mongoose';

export interface IClass extends Document {
    _id: Types.ObjectId;
    schoolId: Types.ObjectId;
    className: string; // "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"
    sections: string[]; // ["A", "B", "C"]
    classTeacherId?: Types.ObjectId;
    roomNumber?: string;
    capacity?: number;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
}

interface IClassModel extends Model<IClass> {}

const classSchema = new Schema<IClass, IClassModel>(
    {
        schoolId: {
            type: Schema.Types.ObjectId,
            ref: 'School',
            required: true,
            index: true,
        },
        className: {
            type: String,
            required: true,
            trim: true,
        },
        sections: {
            type: [String],
            default: ['A'],
        },
        classTeacherId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
        },
        roomNumber: {
            type: String,
            trim: true,
        },
        capacity: {
            type: Number,
            min: 0,
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

classSchema.index({ schoolId: 1, className: 1 }, { unique: true });

const Class = model<IClass, IClassModel>('Class', classSchema);

export default Class;
