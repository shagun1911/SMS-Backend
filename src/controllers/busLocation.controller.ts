import { Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { AuthRequest, UserRole } from '../types';
import Bus from '../models/bus.model';
import { sendResponse } from '../utils/response';
import {
    applyCrewLocationUpdate,
    findBusIdForCrewUser,
    getLatestLocationForBus,
    BUS_LOCATION_STALE_MS,
} from '../services/busLiveLocation.service';
import Student from '../models/student.model';

class BusLocationController {
    /**
     * GET /auth/crew/bus-assignment — driver/conductor only; bus derived from staff assignment.
     */
    async getCrewBusAssignment(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const user = req.user!;
            const role = user.role as UserRole;
            if (role !== UserRole.BUS_DRIVER && role !== UserRole.CONDUCTOR) {
                res.status(403).json({ success: false, message: 'Only bus drivers and conductors can access this.' });
                return;
            }
            const busIdStr = await findBusIdForCrewUser(
                user._id as mongoose.Types.ObjectId,
                user.schoolId as mongoose.Types.ObjectId | undefined
            );
            if (!busIdStr) {
                sendResponse(res, { bus: null }, 'No bus assigned to this account', 200);
                return;
            }
            const bus = await Bus.findById(busIdStr)
                .select('busNumber routeName registrationNumber isActive')
                .lean();
            sendResponse(
                res,
                { bus: bus ? { ...bus, _id: busIdStr } : null },
                'Bus assignment',
                200
            );
        } catch (e) {
            next(e);
        }
    }

    /**
     * POST /auth/crew/bus-location — HTTP fallback for background location task (same rules as socket).
     */
    async postCrewLocation(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const user = req.user!;
            const { lat, lng, accuracy } = req.body ?? {};
            const result = await applyCrewLocationUpdate({
                userId: user._id as mongoose.Types.ObjectId,
                schoolId: user.schoolId as mongoose.Types.ObjectId | undefined,
                role: user.role,
                lat,
                lng,
                accuracy,
            });
            if (!result.ok) {
                const status = result.reason === 'NOT_CREW' ? 403 : result.reason === 'NO_BUS_ASSIGNMENT' ? 404 : 400;
                res.status(status).json({ success: false, message: result.reason });
                return;
            }
            sendResponse(res, { accepted: true }, 'Location recorded', 200);
        } catch (e) {
            next(e);
        }
    }

    /**
     * GET /auth/student/bus-location/latest — last known position for the student's assigned bus only.
     */
    async getStudentBusLatest(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const student = await Student.findById(req.student!._id).select('usesTransport busId').lean();
            if (!student?.usesTransport || !student.busId) {
                sendResponse(
                    res,
                    { location: null, staleAfterMs: BUS_LOCATION_STALE_MS },
                    'No school bus on your profile',
                    200
                );
                return;
            }
            const loc = await getLatestLocationForBus(student.busId as mongoose.Types.ObjectId);
            if (!loc) {
                sendResponse(
                    res,
                    { location: null, staleAfterMs: BUS_LOCATION_STALE_MS },
                    'No location yet',
                    200
                );
                return;
            }
            sendResponse(
                res,
                {
                    location: {
                        lat: loc.lat,
                        lng: loc.lng,
                        accuracy: loc.accuracy,
                        updatedAt: loc.updatedAt,
                    },
                    staleAfterMs: BUS_LOCATION_STALE_MS,
                },
                'Latest bus location',
                200
            );
        } catch (e) {
            next(e);
        }
    }
}

export default new BusLocationController();
