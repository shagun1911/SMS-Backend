import { IFeeStructure } from '../types';
import FeeStructure from '../models/feeStructure.model';
import { BaseRepository } from './base.repository';

class FeeStructureRepository extends BaseRepository<IFeeStructure> {
    constructor() {
        super(FeeStructure);
    }

    async findByClass(
        schoolId: string,
        sessionId: string,
        className: string
    ): Promise<IFeeStructure | null> {
        return await this.model.findOne({ schoolId, sessionId, class: className });
    }

    async findBySession(schoolId: string, sessionId: string): Promise<IFeeStructure[]> {
        return await this.model.find({ schoolId, sessionId });
    }

    async bulkCreate(structures: Partial<IFeeStructure>[]): Promise<IFeeStructure[]> {
        return await this.model.insertMany(structures) as unknown as IFeeStructure[];
    }
}

export default new FeeStructureRepository();
