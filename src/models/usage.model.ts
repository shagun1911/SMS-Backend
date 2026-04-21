import { Schema, model, Model } from 'mongoose';
import { Types } from 'mongoose';

export interface IUsage {
    schoolId: Types.ObjectId;
    totalStudents: number;
    totalTeachers: number;
    lastUpdated: Date;
}

interface IUsageModel extends Model<IUsage> {}

const usageSchema = new Schema<IUsage, IUsageModel>(
    {
        schoolId: { type: Schema.Types.ObjectId, ref: 'School', required: true, unique: true },
        totalStudents: { type: Number, default: 0, min: 0 },
        totalTeachers: { type: Number, default: 0, min: 0 },
        lastUpdated: { type: Date, default: Date.now },
    },
    { timestamps: false }
);


export default model<IUsage, IUsageModel>('Usage', usageSchema);
