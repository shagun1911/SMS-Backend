import { IAuditLog } from '../types';
import AuditLog from '../models/auditLog.model';
import { BaseRepository } from './base.repository';

class AuditRepository extends BaseRepository<IAuditLog> {
    constructor() {
        super(AuditLog);
    }

    async findBySchool(schoolId: string, limit = 100): Promise<IAuditLog[]> {
        return await this.model.find({ schoolId }).sort({ createdAt: -1 }).limit(limit);
    }

    async findByUser(userId: string, limit = 50): Promise<IAuditLog[]> {
        return await this.model.find({ userId }).sort({ createdAt: -1 }).limit(limit);
    }
}

export default new AuditRepository();
