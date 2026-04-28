import { Response, NextFunction } from 'express';
import AdmissionEnquiryService from '../services/admissionEnquiry.service';
import { AuthRequest } from '../types';
import { sendResponse } from '../utils/response';

class AdmissionEnquiryController {
    /**
     * Create a new admission enquiry
     */
    async createEnquiry(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const enquiry = await AdmissionEnquiryService.createEnquiry(req.schoolId!, req.body);
            sendResponse(res, enquiry, 'Enquiry created successfully', 201);
        } catch (error) {
            next(error);
        }
    }

    /**
     * Get all enquiries with filters
     */
    async getEnquiries(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const { page, limit, search, class: className, status } = req.query;
            const safePage = parseInt(page as string, 10) || 1;
            const safeLimit = parseInt(limit as string, 10) || 50;

            const result = await AdmissionEnquiryService.listEnquiries(req.schoolId!, {
                page: safePage,
                limit: safeLimit,
                search: search as string,
                class: className as string,
                status: status as string,
            });
            res.setHeader('X-Total-Count', String(result.total));
            res.setHeader('X-Page', String(safePage));
            res.setHeader('X-Limit', String(safeLimit));

            res.status(200).json({
                success: true,
                data: result.enquiries,
                pagination: {
                    total: result.total,
                    pages: result.pages,
                    page: safePage,
                    limit: safeLimit,
                },
            });
        } catch (error) {
            next(error);
        }
    }

    /**
     * Get single enquiry
     */
    async getEnquiry(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const enquiry = await AdmissionEnquiryService.getEnquiry(req.schoolId!, req.params.id);
            sendResponse(res, enquiry, 'Enquiry retrieved successfully', 200);
        } catch (error) {
            next(error);
        }
    }

    /**
     * Update enquiry
     */
    async updateEnquiry(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const enquiry = await AdmissionEnquiryService.updateEnquiry(req.schoolId!, req.params.id, req.body);
            sendResponse(res, enquiry, 'Enquiry updated successfully', 200);
        } catch (error) {
            next(error);
        }
    }

    /**
     * Delete enquiry
     */
    async deleteEnquiry(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            await AdmissionEnquiryService.deleteEnquiry(req.schoolId!, req.params.id);
            sendResponse(res, null, 'Enquiry deleted successfully', 200);
        } catch (error) {
            next(error);
        }
    }

    /**
     * Get enquiry statistics
     */
    async getEnquiryStats(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const stats = await AdmissionEnquiryService.getEnquiryStats(req.schoolId!);
            sendResponse(res, stats, 'Enquiry statistics retrieved successfully', 200);
        } catch (error) {
            next(error);
        }
    }

    /**
     * Get enquiry count
     */
    async getEnquiryCount(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const count = await AdmissionEnquiryService.getEnquiryCount(req.schoolId!);
            sendResponse(res, { count }, 'Enquiry count retrieved successfully', 200);
        } catch (error) {
            next(error);
        }
    }
}

export default new AdmissionEnquiryController();
