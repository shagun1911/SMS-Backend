import { Schema, model, Document, Types } from 'mongoose';

export type QuestionSource = 'pyq' | 'ai' | 'coaching' | 'manual';
export type QuestionType = 'objective' | 'subjective';
export type Difficulty = 'easy' | 'medium' | 'hard';
export type CoachingStyle = 'allen' | 'fiitjee' | 'aakash';

export interface IQuestionBank extends Document {
    schoolId?: Types.ObjectId;
    examType: 'boards' | 'jee' | 'neet' | 'school';
    className: string;
    subject: string;
    chapter: string;
    topic?: string;
    difficulty: Difficulty;
    questionType: QuestionType;
    source: QuestionSource;
    coachingStyle?: CoachingStyle;
    question: string;
    options?: string[];
    answer: string;
    solution?: string;
    questionHash: string;
    usageCount: number;
}

const questionBankSchema = new Schema<IQuestionBank>(
    {
        schoolId: { type: Schema.Types.ObjectId, ref: 'School' },
        examType: { type: String, enum: ['boards', 'jee', 'neet', 'school'], required: true },
        className: { type: String, required: true, trim: true },
        subject: { type: String, required: true, trim: true },
        chapter: { type: String, required: true, trim: true },
        topic: { type: String, trim: true },
        difficulty: { type: String, enum: ['easy', 'medium', 'hard'], required: true },
        questionType: { type: String, enum: ['objective', 'subjective'], required: true },
        source: { type: String, enum: ['pyq', 'ai', 'coaching', 'manual'], required: true },
        coachingStyle: { type: String, enum: ['allen', 'fiitjee', 'aakash'] },
        question: { type: String, required: true, trim: true },
        options: [{ type: String }],
        answer: { type: String, required: true, trim: true },
        solution: { type: String, trim: true },
        questionHash: { type: String, required: true, trim: true },
        usageCount: { type: Number, default: 0 },
    },
    { timestamps: true }
);

questionBankSchema.index({ examType: 1, className: 1, subject: 1, chapter: 1 });
questionBankSchema.index({ questionHash: 1 }, { unique: true });

const QuestionBank = model<IQuestionBank>('QuestionBank', questionBankSchema);
export default QuestionBank;
