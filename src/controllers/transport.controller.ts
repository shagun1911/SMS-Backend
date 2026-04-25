import { Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { AuthRequest, UserRole } from '../types';
import Bus from '../models/bus.model';
import BusLocation from '../models/busLocation.model';
import Student from '../models/student.model';
import User from '../models/user.model';
import { getTenantFilter } from '../utils/tenant';
import { sendResponse } from '../utils/response';

/** Compare crew assignments using normalized name + phone (matches mobile/web staff picks). */
function staffIdentityKey(name?: string, phone?: string): string | null {
    const n = (name ?? '').trim().toLowerCase();
    const p = String(phone ?? '').replace(/\D/g, '');
    if (!n && !p) return null;
    return `${n}|${p}`;
}

const MANAGER_ONLINE_WINDOW_MS = 10_000;

/**
 * Before saving a bus: remove this driver/conductor from every other bus in the school.
 */
async function clearCrewIdentityFromOtherBuses(
    schoolId: string | undefined,
    excludeBusId: string | undefined,
    driverName: string | undefined,
    driverPhone: string | undefined,
    conductorName: string | undefined,
    conductorPhone: string | undefined,
    driverUserId?: string,
    conductorUserId?: string
): Promise<void> {
    if (!schoolId || !mongoose.isValidObjectId(schoolId)) return;

    const schoolOid = new mongoose.Types.ObjectId(schoolId);
    const excludeOid =
        excludeBusId && mongoose.isValidObjectId(excludeBusId)
            ? new mongoose.Types.ObjectId(excludeBusId)
            : null;

    const baseQuery: Record<string, unknown> = { schoolId: schoolOid };
    if (excludeOid) baseQuery._id = { $ne: excludeOid };

    const clearDriverSlot = {
        $set: { driverName: '', driverPhone: '' },
        $unset: { driverUserId: 1 as const },
    };
    const clearConductorSlot = {
        $set: { conductorName: '', conductorPhone: '' },
        $unset: { conductorUserId: 1 as const },
    };

    if (driverUserId && mongoose.isValidObjectId(driverUserId)) {
        const uid = new mongoose.Types.ObjectId(driverUserId);
        await Bus.updateMany({ ...baseQuery, driverUserId: uid }, clearDriverSlot);
    }
    if (conductorUserId && mongoose.isValidObjectId(conductorUserId)) {
        const uid = new mongoose.Types.ObjectId(conductorUserId);
        await Bus.updateMany({ ...baseQuery, conductorUserId: uid }, clearConductorSlot);
    }

    let dKey = staffIdentityKey(driverName, driverPhone);
    let cKey = staffIdentityKey(conductorName, conductorPhone);
    if (driverUserId && mongoose.isValidObjectId(driverUserId)) {
        const u = await User.findById(driverUserId).select('name phone').lean();
        if (u) dKey = staffIdentityKey(u.name, u.phone) || dKey;
    }
    if (conductorUserId && mongoose.isValidObjectId(conductorUserId)) {
        const u = await User.findById(conductorUserId).select('name phone').lean();
        if (u) cKey = staffIdentityKey(u.name, u.phone) || cKey;
    }

    if (!dKey && !cKey) return;

    const others = await Bus.find(baseQuery)
        .select('_id driverName driverPhone conductorName conductorPhone')
        .lean();

    for (const b of others) {
        const od = staffIdentityKey(b.driverName, b.driverPhone);
        const oc = staffIdentityKey(b.conductorName, b.conductorPhone);
        const $set: Record<string, string> = {};
        const $unset: Record<string, 1> = {};
        if (dKey) {
            if (od === dKey) {
                $set.driverName = '';
                $set.driverPhone = '';
                $unset.driverUserId = 1;
            }
            if (oc === dKey) {
                $set.conductorName = '';
                $set.conductorPhone = '';
                $unset.conductorUserId = 1;
            }
        }
        if (cKey) {
            if (od === cKey) {
                $set.driverName = '';
                $set.driverPhone = '';
                $unset.driverUserId = 1;
            }
            if (oc === cKey) {
                $set.conductorName = '';
                $set.conductorPhone = '';
                $unset.conductorUserId = 1;
            }
        }
        if (Object.keys($set).length > 0 || Object.keys($unset).length > 0) {
            const update: Record<string, unknown> = {};
            if (Object.keys($set).length) update.$set = $set;
            if (Object.keys($unset).length) update.$unset = $unset;
            await Bus.updateOne({ _id: b._id }, update);
        }
    }
}

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
            const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
            const limit = Math.min(parseInt(req.query.limit as string, 10) || 100, 500);
            const skip = (page - 1) * limit;
            const [fleet, total] = await Promise.all([
                Bus.find(filter)
                    .sort({ busNumber: 1 })
                    .skip(skip)
                    .limit(limit)
                    .lean(),
                Bus.countDocuments(filter),
            ]);
            res.setHeader('X-Total-Count', String(total));
            res.setHeader('X-Page', String(page));
            res.setHeader('X-Limit', String(limit));
            sendResponse(res, fleet, 'Fleet retrieved', 200);
        } catch (error) {
            next(error);
        }
    }

    async addVehicle(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const schoolId = req.schoolId?.toString();
            await clearCrewIdentityFromOtherBuses(
                schoolId,
                undefined,
                req.body.driverName,
                req.body.driverPhone,
                req.body.conductorName,
                req.body.conductorPhone,
                req.body.driverUserId,
                req.body.conductorUserId
            );

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

            let location = null;
            if (req.user?.role === UserRole.TRANSPORT_MANAGER) {
                const loc = await BusLocation.findOne({ busId: bus._id })
                    .select('lat lng updatedAt updatedBy')
                    .lean();
                let updatedByRole: 'driver' | 'conductor' | null = null;
                if (loc?.updatedBy) {
                    const updater = await User.findById(loc.updatedBy).select('role').lean();
                    if (updater?.role === UserRole.BUS_DRIVER) updatedByRole = 'driver';
                    else if (updater?.role === UserRole.CONDUCTOR) updatedByRole = 'conductor';
                }
                const now = Date.now();
                const updatedAt = loc?.updatedAt ? new Date(loc.updatedAt) : null;
                const ageMs = updatedAt ? now - updatedAt.getTime() : Number.POSITIVE_INFINITY;
                location = {
                    latitude: typeof loc?.lat === 'number' ? loc.lat : null,
                    longitude: typeof loc?.lng === 'number' ? loc.lng : null,
                    updatedAt,
                    updatedByRole,
                    isOnline: ageMs <= MANAGER_ONLINE_WINDOW_MS,
                };
            }

            sendResponse(
                res,
                { bus, students, location },
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

            await clearCrewIdentityFromOtherBuses(
                req.schoolId?.toString(),
                busId,
                req.body.driverName,
                req.body.driverPhone,
                req.body.conductorName,
                req.body.conductorPhone,
                req.body.driverUserId,
                req.body.conductorUserId
            );

            const setFields: Record<string, unknown> = {
                busNumber: req.body.busNumber,
                registrationNumber: req.body.registrationNumber,
                routeName: req.body.routeName,
                capacity: req.body.capacity,
                isActive: req.body.isActive,
                driverName: req.body.driverName,
                driverPhone: req.body.driverPhone,
                conductorName: req.body.conductorName,
                conductorPhone: req.body.conductorPhone,
            };
            const unsetFields: Record<string, 1> = {};
            const dUid = req.body.driverUserId ? String(req.body.driverUserId) : '';
            const cUid = req.body.conductorUserId ? String(req.body.conductorUserId) : '';
            if (dUid && mongoose.isValidObjectId(dUid)) {
                setFields.driverUserId = new mongoose.Types.ObjectId(dUid);
            } else {
                unsetFields.driverUserId = 1;
            }
            if (cUid && mongoose.isValidObjectId(cUid)) {
                setFields.conductorUserId = new mongoose.Types.ObjectId(cUid);
            } else {
                unsetFields.conductorUserId = 1;
            }

            const updateDoc: Record<string, unknown> = { $set: setFields };
            if (Object.keys(unsetFields).length) updateDoc.$unset = unsetFields;

            const updated = await Bus.findOneAndUpdate({ ...filter, _id: busId }, updateDoc, {
                new: true,
            });

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
