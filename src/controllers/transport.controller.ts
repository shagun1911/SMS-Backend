import { Response, NextFunction } from 'express';
import { AuthRequest, UserRole } from '../types';
import Bus from '../models/bus.model';
import Student from '../models/student.model';
import User from '../models/user.model';
import { getTenantFilter } from '../utils/tenant';
import { sendResponse } from '../utils/response';

class TransportController {
    /** Active bus drivers & conductors (school admin creates them under Staff). */
    async getCrewOptions(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const schoolId = req.schoolId!;
            const base = { schoolId, isActive: { $ne: false } };
            const [drivers, conductors] = await Promise.all([
                User.find({ ...base, role: UserRole.BUS_DRIVER })
                    .select('name phone role')
                    .sort({ name: 1 })
                    .lean(),
                User.find({ ...base, role: UserRole.CONDUCTOR })
                    .select('name phone role')
                    .sort({ name: 1 })
                    .lean(),
            ]);
            sendResponse(
                res,
                { drivers, conductors },
                'Transport crew options',
                200
            );
        } catch (error) {
            next(error);
        }
    }

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

    async getBusDetails(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const filter = getTenantFilter(req.schoolId!);
            const busId = req.params.busId;

            const bus = await Bus.findOne({ ...filter, _id: busId });
            if (!bus) {
                return sendResponse(res, null as any, 'Bus not found', 404);
            }

            const students = await Student.find({
                ...filter,
                usesTransport: true,
                busId: bus._id,
            }).select('firstName lastName admissionNumber class section rollNumber phone username');

            sendResponse(
                res,
                { bus, students },
                'Bus details retrieved',
                200
            );
        } catch (error) {
            next(error);
        }
    }

    async updateVehicle(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const filter = getTenantFilter(req.schoolId!);
            const busId = req.params.busId;

            const updated = await Bus.findOneAndUpdate(
                { ...filter, _id: busId },
                {
                    $set: {
                        busNumber: req.body.busNumber,
                        registrationNumber: req.body.registrationNumber,
                        routeName: req.body.routeName,
                        capacity: req.body.capacity,
                        isActive: req.body.isActive,
                        driverName: req.body.driverName,
                        driverPhone: req.body.driverPhone,
                        conductorName: req.body.conductorName,
                        conductorPhone: req.body.conductorPhone,
                    },
                },
                { new: true }
            );

            if (!updated) return sendResponse(res, null as any, 'Bus not found', 404);
            sendResponse(res, updated, 'Vehicle updated', 200);
        } catch (error) {
            next(error);
        }
    }

    async assignStudentsToBus(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const filter = getTenantFilter(req.schoolId!);
            const busId = req.params.busId;
            const studentIds: string[] = Array.isArray(req.body?.studentIds) ? req.body.studentIds : [];
            if (studentIds.length === 0) {
                return sendResponse(res, { assigned: 0 }, 'No students selected', 200);
            }

            const bus = await Bus.findOne({ ...filter, _id: busId }).select('_id');
            if (!bus) return sendResponse(res, null as any, 'Bus not found', 404);

            const result = await Student.updateMany(
                { ...filter, _id: { $in: studentIds } },
                { $set: { usesTransport: true, busId: bus._id } }
            );

            sendResponse(
                res,
                { assigned: (result as any).modifiedCount ?? (result as any).nModified ?? 0 },
                'Students assigned to bus',
                200
            );
        } catch (error) {
            next(error);
        }
    }

    async unassignStudentsFromBus(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const filter = getTenantFilter(req.schoolId!);
            const busId = req.params.busId;
            const studentIds: string[] = Array.isArray(req.body?.studentIds) ? req.body.studentIds : [];
            if (studentIds.length === 0) {
                return sendResponse(res, { unassigned: 0 }, 'No students selected', 200);
            }

            const result = await Student.updateMany(
                { ...filter, _id: { $in: studentIds }, busId },
                { $set: { usesTransport: false }, $unset: { busId: 1 } }
            );

            sendResponse(
                res,
                { unassigned: (result as any).modifiedCount ?? (result as any).nModified ?? 0 },
                'Students unassigned from bus',
                200
            );
        } catch (error) {
            next(error);
        }
    }
}

export default new TransportController();
