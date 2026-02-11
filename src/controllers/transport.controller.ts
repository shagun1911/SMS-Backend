import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import Bus from '../models/bus.model';
import { getTenantFilter } from '../utils/tenant';
import { sendResponse } from '../utils/response';

class TransportController {
    async getFleet(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const filter = getTenantFilter(req.schoolId!);
            const fleet = await Bus.find(filter);
            sendResponse(res, fleet, 'Fleet retrieved', 200);
        } catch (error) {
            next(error);
        }
    }

    async addVehicle(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const vehicle = await Bus.create({
                ...req.body,
                schoolId: req.schoolId
            });
            sendResponse(res, vehicle, 'Vehicle added', 201);
        } catch (error) {
            next(error);
        }
    }
}

export default new TransportController();
