import { ISession } from '../types';
import Session from '../models/session.model';
import { BaseRepository } from './base.repository';

class SessionRepository extends BaseRepository<ISession> {
    constructor() {
        super(Session);
    }

    async findActive(schoolId: string): Promise<ISession | null> {
        return await this.findOne({ schoolId, isActive: true });
    }

    async findByYear(schoolId: string, year: string): Promise<ISession | null> {
        return await this.findOne({ schoolId, sessionYear: year });
    }
}

export default new SessionRepository();
