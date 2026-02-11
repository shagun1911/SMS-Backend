import { Schema, model, Model } from 'mongoose';
import { IAuditLog, AuditAction } from '../types';

interface IAuditLogModel extends Model<IAuditLog> { }

const auditLogSchema = new Schema<IAuditLog, IAuditLogModel>(
    {
        schoolId: {
            type: Schema.Types.ObjectId,
            ref: 'School',
            index: true,
        },
        userId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        action: {
            type: String,
            enum: Object.values(AuditAction),
            required: true,
            index: true,
        },
        module: {
            type: String, // e.g., 'Student', 'Fee', 'Auth'
            required: true,
            index: true,
        },
        description: {
            type: String,
            required: true,
        },
        metadata: {
            type: Map,
            of: Schema.Types.Mixed,
        },
        ipAddress: {
            type: String,
        },
        userAgent: {
            type: String,
        },
    },
    {
        timestamps: true, // Only use createdAt for logs, updatedAt is redundant but Mongoose adds it automatically
        // We can disable updatedAt if strict:
        // timestamps: { createdAt: true, updatedAt: false }
    }
);

// Indexes
// Standard query: Logs for a specific school, sorted by date
auditLogSchema.index({ schoolId: 1, createdAt: -1 });
// Query logs by user
auditLogSchema.index({ userId: 1, createdAt: -1 });

const AuditLog = model<IAuditLog, IAuditLogModel>('AuditLog', auditLogSchema);

export default AuditLog;
