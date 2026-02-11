import { Schema, model, Document, Types } from 'mongoose';

export enum ExamType {
    UNIT_TEST = 'unit_test',
    QUARTERLY = 'quarterly',
    HALF_YEARLY = 'half_yearly',
    ANNUAL = 'annual'
}

export interface IExam extends Document {
    schoolId: Types.ObjectId;
    sessionId: Types.ObjectId;
    title: string;
    type: ExamType;
    startDate: Date;
    endDate: Date;
    classes: string[];
    isActive: boolean;
}

const examSchema = new Schema<IExam>(
    {
        schoolId: {
            type: Schema.Types.ObjectId,
            ref: 'School',
            required: true,
            index: true,
        },
        sessionId: {
            type: Schema.Types.ObjectId,
            ref: 'Session',
            required: true,
        },
        title: {
            type: String,
            required: true,
            trim: true,
        },
        type: {
            type: String,
            enum: Object.values(ExamType),
            required: true,
        },
        startDate: {
            type: Date,
            required: true,
        },
        endDate: {
            type: Date,
            required: true,
        },
        classes: [{
            type: String,
            required: true,
        }],
        isActive: {
            type: Boolean,
            default: true,
        },
    },
    {
        timestamps: true,
    }
);

const Exam = model<IExam>('Exam', examSchema);

export default Exam;
