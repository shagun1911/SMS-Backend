import { Schema, model, Model } from 'mongoose';

export type AnnouncementPriority = 'info' | 'warning' | 'critical';

export interface ISystemAnnouncement {
    title: string;
    message: string;
    priority: AnnouncementPriority;
    createdAt: Date;
    expiresAt?: Date;
    isActive: boolean;
    updatedAt: Date;
}

interface ISystemAnnouncementModel extends Model<ISystemAnnouncement> {}

const systemAnnouncementSchema = new Schema<ISystemAnnouncement, ISystemAnnouncementModel>(
    {
        title: { type: String, required: true, trim: true },
        message: { type: String, required: true },
        priority: { type: String, enum: ['info', 'warning', 'critical'], default: 'info' },
        expiresAt: { type: Date },
        isActive: { type: Boolean, default: true },
    },
    { timestamps: true }
);

// School dashboard: fetch active, non-expired announcements (high-frequency read)
systemAnnouncementSchema.index({ isActive: 1, expiresAt: 1 });
// Admin list sorted by newest
systemAnnouncementSchema.index({ createdAt: -1 });

export default model<ISystemAnnouncement, ISystemAnnouncementModel>('SystemAnnouncement', systemAnnouncementSchema);
