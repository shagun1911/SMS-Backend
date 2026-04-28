import { IAdmissionEnquiry, EnquiryStatus } from '../types';
import AdmissionEnquiry from '../models/admissionEnquiry.model';
import { BaseRepository } from './base.repository';

class AdmissionEnquiryRepository extends BaseRepository<IAdmissionEnquiry> {
    constructor() {
        super(AdmissionEnquiry);
    }

    async findBySchool(schoolId: string): Promise<IAdmissionEnquiry[]> {
        return await this.find({ schoolId });
    }

    async findByStatus(schoolId: string, status: EnquiryStatus): Promise<IAdmissionEnquiry[]> {
        return await this.find({ schoolId, status });
    }

    async findByClass(schoolId: string, classValue: string): Promise<IAdmissionEnquiry[]> {
        return await this.find({ schoolId, class: classValue });
    }

    async countByStatus(schoolId: string, status: EnquiryStatus): Promise<number> {
        return await this.model.countDocuments({ schoolId, status }).exec();
    }
}

export default new AdmissionEnquiryRepository();
