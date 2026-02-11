import { ISchool } from '../types';
import School from '../models/school.model';
import { BaseRepository } from './base.repository';

class SchoolRepository extends BaseRepository<ISchool> {
    constructor() {
        super(School);
    }

    async findByCode(code: string): Promise<ISchool | null> {
        return await this.findOne({ schoolCode: code });
    }

    async findByEmail(email: string): Promise<ISchool | null> {
        return await this.findOne({ email });
    }
}

export default new SchoolRepository();
