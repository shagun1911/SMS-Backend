import { Schema, model, Model, Types } from 'mongoose';

export type SupportTicketStatus = 'open' | 'in_progress' | 'resolved';
export type SupportTicketPriority = 'low' | 'medium' | 'high';

export interface ISupportTicket {
    schoolId: Types.ObjectId;
    schoolName: string;
    subject: string;
    message: string;
    status: SupportTicketStatus;
    priority: SupportTicketPriority;
    createdAt: Date;
    resolvedAt?: Date;
    resolvedBy?: Types.ObjectId;
    resolution?: string;
    updatedAt: Date;
}

interface ISupportTicketModel extends Model<ISupportTicket> {}

const supportTicketSchema = new Schema<ISupportTicket, ISupportTicketModel>(
    {
        schoolId: { type: Schema.Types.ObjectId, ref: 'School', required: true },
        schoolName: { type: String, required: true, trim: true },
        subject: { type: String, required: true, trim: true },
        message: { type: String, required: true },
        status: { type: String, enum: ['open', 'in_progress', 'resolved'], default: 'open' },
        priority: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
        resolvedAt: { type: Date },
        resolvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
        resolution: { type: String },
    },
    { timestamps: true }
);

export default model<ISupportTicket, ISupportTicketModel>('SupportTicket', supportTicketSchema);
