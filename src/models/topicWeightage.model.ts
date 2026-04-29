import { Schema, model, Document } from 'mongoose';

export interface ITopicWeightage extends Document {
    examType: 'boards' | 'jee' | 'neet' | 'school';
    className: string;
    subject: string;
    chapter: string;
    topic: string;
    frequencyScore: number;
}

const topicWeightageSchema = new Schema<ITopicWeightage>(
    {
        examType: { type: String, enum: ['boards', 'jee', 'neet', 'school'], required: true },
        className: { type: String, required: true, trim: true },
        subject: { type: String, required: true, trim: true },
        chapter: { type: String, required: true, trim: true },
        topic: { type: String, required: true, trim: true },
        frequencyScore: { type: Number, required: true, default: 1 },
    },
    { timestamps: true }
);

topicWeightageSchema.index({ examType: 1, className: 1, subject: 1, chapter: 1 });

const TopicWeightage = model<ITopicWeightage>('TopicWeightage', topicWeightageSchema);
export default TopicWeightage;
