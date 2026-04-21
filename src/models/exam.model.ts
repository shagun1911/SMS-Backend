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

// List exams for a school session (primary query pattern)
examSchema.index({ schoolId: 1, sessionId: 1 });
// Filter active exams per school (dashboard/student view)
examSchema.index({ schoolId: 1, isActive: 1, startDate: -1 });

const Exam = model<IExam>('Exam', examSchema);

export default Exam;
