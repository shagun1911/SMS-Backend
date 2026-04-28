import { IAdmissionEnquiry, EnquiryStatus } from '../types';
import AdmissionEnquiryRepository from '../repositories/admissionEnquiry.repository';
import ErrorResponse from '../utils/errorResponse';
import { getTenantFilter } from '../utils/tenant';
import { updateUsageForSchool } from './usage.service';

class AdmissionEnquiryService {
    /**
     * Create a new admission enquiry
     */
    async createEnquiry(schoolId: string, enquiryData: Partial<IAdmissionEnquiry>): Promise<IAdmissionEnquiry> {
        const enquiry = await AdmissionEnquiryRepository.create({
            ...enquiryData,
            schoolId,
        } as any);

        await updateUsageForSchool(schoolId);
        return enquiry;
    }

    /**
     * List enquiries with pagination and filters
     */
    async listEnquiries(
        schoolId: string,
        query: { page?: number; limit?: number; search?: string; class?: string; status?: string }
    ): Promise<{ enquiries: IAdmissionEnquiry[]; total: number; pages: number }> {
        const page = query.page || 1;
        const limit = query.limit || 50;
        const skip = (page - 1) * limit;

        let filter = getTenantFilter(schoolId);

        if (query.class) filter.class = query.class;
        if (query.status) filter.status = query.status;

        if (query.search) {
            filter.$or = [
                { studentName: { $regex: query.search, $options: 'i' } },
                { fatherName: { $regex: query.search, $options: 'i' } },
                { phone: { $regex: query.search, $options: 'i' } },
            ];
        }

        const AdmissionEnquiry = AdmissionEnquiryRepository.getModel();
        const [result, total] = await Promise.all([
            AdmissionEnquiry.find(filter)
                .sort({ enquiryDate: -1 })
                .skip(skip)
                .limit(limit)
                .lean().exec() as unknown as IAdmissionEnquiry[],
            AdmissionEnquiry.countDocuments(filter),
        ]);

        return {
            enquiries: result,
            total,
            pages: Math.ceil(total / limit),
        };
    }

    /**
     * Get enquiry by ID
     */
    async getEnquiry(schoolId: string, id: string): Promise<IAdmissionEnquiry> {
        const filter = getTenantFilter(schoolId, { _id: id });
        const enquiry = await AdmissionEnquiryRepository.findOne(filter);
        if (!enquiry) {
            throw new ErrorResponse('Enquiry not found', 404);
        }
        return enquiry;
    }

    /**
     * Update enquiry
     */
    async updateEnquiry(schoolId: string, id: string, data: Partial<IAdmissionEnquiry>): Promise<IAdmissionEnquiry> {
        const filter = getTenantFilter(schoolId, { _id: id });
        const enquiry = await AdmissionEnquiryRepository.findOne(filter);
        if (!enquiry) {
            throw new ErrorResponse('Enquiry not found', 404);
        }

        const updatedEnquiry = await AdmissionEnquiryRepository.update(id, data);
        if (!updatedEnquiry) {
            throw new ErrorResponse('Enquiry not found', 404);
        }
        return updatedEnquiry;
    }

    /**
     * Delete enquiry
     */
    async deleteEnquiry(schoolId: string, id: string): Promise<void> {
        const filter = getTenantFilter(schoolId, { _id: id });
        const enquiry = await AdmissionEnquiryRepository.findOne(filter);
        if (!enquiry) {
            throw new ErrorResponse('Enquiry not found', 404);
        }

        await AdmissionEnquiryRepository.delete(id);
        await updateUsageForSchool(schoolId);
    }

    /**
     * Get enquiry statistics
     */
    async getEnquiryStats(schoolId: string): Promise<{
        total: number;
        pending: number;
        followUp: number;
        converted: number;
        rejected: number;
    }> {
        const AdmissionEnquiry = AdmissionEnquiryRepository.getModel();
        const filter = getTenantFilter(schoolId);

        const [total, pending, followUp, converted, rejected] = await Promise.all([
            AdmissionEnquiry.countDocuments(filter),
            AdmissionEnquiry.countDocuments({ ...filter, status: EnquiryStatus.PENDING }),
            AdmissionEnquiry.countDocuments({ ...filter, status: EnquiryStatus.FOLLOW_UP }),
            AdmissionEnquiry.countDocuments({ ...filter, status: EnquiryStatus.CONVERTED }),
            AdmissionEnquiry.countDocuments({ ...filter, status: EnquiryStatus.REJECTED }),
        ]);

        return { total, pending, followUp, converted, rejected };
    }

    /**
     * Get enquiry count
     */
    async getEnquiryCount(schoolId: string): Promise<number> {
        const AdmissionEnquiry = AdmissionEnquiryRepository.getModel();
        const filter = getTenantFilter(schoolId);
        return await AdmissionEnquiry.countDocuments(filter);
    }
}

export default new AdmissionEnquiryService();
