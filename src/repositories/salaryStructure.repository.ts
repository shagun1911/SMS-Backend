import { ISalaryStructure } from '../types';
import SalaryStructure from '../models/salaryStructure.model';
import { BaseRepository } from './base.repository';

class SalaryStructureRepository extends BaseRepository<ISalaryStructure> {
    constructor() {
        super(SalaryStructure);
    }

    async findActiveByStaff(
        schoolId: string,
        staffId: string
    ): Promise<ISalaryStructure | null> {
        return await this.model.findOne({
            schoolId,
            staffId,
            isActive: true
        }).exec();
    }
}

export default new SalaryStructureRepository();

