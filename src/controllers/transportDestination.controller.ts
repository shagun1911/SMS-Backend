import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import TransportDestinationService from '../services/transportDestination.service';
import { sendResponse } from '../utils/response';

class TransportDestinationController {
    async getDestinations(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
            const limit = Math.min(parseInt(req.query.limit as string, 10) || 100, 500);
            const { items, total } = await TransportDestinationService.getDestinationsBySchool(req.schoolId!, { page, limit });
            res.setHeader('X-Total-Count', String(total));
            res.setHeader('X-Page', String(page));
            res.setHeader('X-Limit', String(limit));
            return sendResponse(res, items, 'Transport destinations retrieved', 200);
        } catch (error) {
            return next(error);
        }
    }

    async createDestination(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const { destinationName, monthlyFee } = req.body;
            if (!destinationName || monthlyFee === undefined || monthlyFee === null) {
                return next(new Error('destinationName and monthlyFee are required'));
            }
            const destination = await TransportDestinationService.createDestination(req.schoolId!, {
                destinationName,
                monthlyFee: Number(monthlyFee),
                isActive: true,
            });
            return sendResponse(res, destination, 'Transport destination created', 201);
        } catch (error) {
            return next(error);
        }
    }

    async updateDestination(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const { destinationName, monthlyFee, isActive } = req.body;
            const destination = await TransportDestinationService.updateDestination(
                req.schoolId!,
                req.params.id,
                {
                    destinationName,
                    monthlyFee: monthlyFee !== undefined ? Number(monthlyFee) : undefined,
                    isActive,
                }
            );
            return sendResponse(res, destination, 'Transport destination updated', 200);
        } catch (error) {
            return next(error);
        }
    }

    async deleteDestination(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            await TransportDestinationService.deleteDestination(req.schoolId!, req.params.id);
            return sendResponse(res, {}, 'Transport destination deleted', 200);
        } catch (error) {
            return next(error);
        }
    }
}

export default new TransportDestinationController();
