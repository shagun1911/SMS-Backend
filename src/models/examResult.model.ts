import { Schema, model, Document, Types } from 'mongoose';

export interface ISubjectResult {
    subject: string;
    maxMarks: number;
    obtainedMarks: number;
    grade?: string;
}

export interface IExamResult extends Document {
    _id: Types.ObjectId;
    schoolId: Types.ObjectId;
    examId: Types.ObjectId;
    studentId: Types.ObjectId;
    class: string;
    section: string;
    subjects: ISubjectResult[];
    totalMarks: number;
    totalObtained: number;
    percentage: number;
    grade: string;
    rank?: number;
    remarks?: string;
    createdAt: Date;
    updatedAt: Date;
}

const subjectResultSchema = new Schema<ISubjectResult>({
    subject: { type: String, required: true },
    maxMarks: { type: Number, required: true },
    obtainedMarks: { type: Number, required: true },
    grade: { type: String },
}, { _id: false });

const examResultSchema = new Schema<IExamResult>(
    {
        schoolId: {
            type: Schema.Types.ObjectId,
            ref: 'School',
            required: true,
            index: true,
        },
        examId: {
            type: Schema.Types.ObjectId,
            ref: 'Exam',
            required: true,
            index: true,
        },
        studentId: {
            type: Schema.Types.ObjectId,
            ref: 'Student',
            required: true,
            index: true,
        },
        class: {
            type: String,
            required: true,
        },
        section: {
            type: String,
            required: true,
        },
        subjects: [subjectResultSchema],
        totalMarks: {
            type: Number,
            required: true,
        },
        totalObtained: {
            type: Number,
            required: true,
        },
        percentage: {
            type: Number,
            required: true,
        },
        grade: {
            type: String,
            required: true,
        },
        rank: {
            type: Number,
        },
        remarks: {
            type: String,
        },
    },
    {
        timestamps: true,
    }
);

examResultSchema.index({ schoolId: 1, examId: 1, studentId: 1 }, { unique: true });
examResultSchema.index({ schoolId: 1, examId: 1, class: 1, percentage: -1 });

const ExamResult = model<IExamResult>('ExamResult', examResultSchema);

export default ExamResult;
