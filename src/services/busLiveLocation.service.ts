import mongoose from 'mongoose';
import Bus from '../models/bus.model';
import BusLocation from '../models/busLocation.model';
import { UserRole } from '../types';
import { getSocketIOServer } from '../lib/socketIoRegistry';

/** Ignore location writes closer than this (per bus). */
const MIN_WRITE_INTERVAL_MS = 4000;
/** Broadcast to subscribers at most this often unless moved significantly. */
const MIN_BROADCAST_INTERVAL_MS = 5000;
/** If moved farther than this (meters), broadcast even if interval not met. */
const MIN_BROADCAST_DISTANCE_M = 12;

const lastWriteAt = new Map<string, number>();
const lastBroadcastMeta = new Map<string, { t: number; lat: number; lng: number }>();

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371000;
    const toRad = (d: number) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

export async function findBusIdForCrewUser(
    userId: mongoose.Types.ObjectId,
    schoolId: mongoose.Types.ObjectId | undefined
): Promise<string | null> {
    if (!schoolId) return null;
    const bus = await Bus.findOne({
        schoolId,
        isActive: true,
        $or: [{ driverUserId: userId }, { conductorUserId: userId }],
    })
        .select('_id')
        .lean();
    return bus?._id ? String(bus._id) : null;
}

export function isCrewRole(role: string): boolean {
    return role === UserRole.BUS_DRIVER || role === UserRole.CONDUCTOR;
}

export type LocationApplyResult =
    | { ok: true; busId: string; broadcast: boolean }
    | { ok: false; reason: string };

/**
 * Validates coords, resolves bus from crew user server-side, persists latest location, emits Socket.IO.
 */
export async function applyCrewLocationUpdate(params: {
    userId: mongoose.Types.ObjectId;
    schoolId: mongoose.Types.ObjectId | undefined;
    role: string;
    lat: unknown;
    lng: unknown;
    accuracy?: unknown;
}): Promise<LocationApplyResult> {
    if (!isCrewRole(params.role)) {
        return { ok: false, reason: 'NOT_CREW' };
    }

    const lat = Number(params.lat);
    const lng = Number(params.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return { ok: false, reason: 'INVALID_COORDS' };
    }
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        return { ok: false, reason: 'INVALID_COORDS' };
    }

    const busIdStr = await findBusIdForCrewUser(params.userId, params.schoolId);
    if (!busIdStr) {
        return { ok: false, reason: 'NO_BUS_ASSIGNMENT' };
    }

    const busObjectId = new mongoose.Types.ObjectId(busIdStr);
    const now = Date.now();
    const prevW = lastWriteAt.get(busIdStr) ?? 0;
    if (now - prevW < MIN_WRITE_INTERVAL_MS) {
        return { ok: true, busId: busIdStr, broadcast: false };
    }
    lastWriteAt.set(busIdStr, now);

    const acc =
        params.accuracy != null && Number.isFinite(Number(params.accuracy))
            ? Number(params.accuracy)
            : undefined;

    await BusLocation.findOneAndUpdate(
        { busId: busObjectId },
        {
            busId: busObjectId,
            lat,
            lng,
            ...(acc != null ? { accuracy: acc } : {}),
            updatedBy: params.userId,
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    const meta = lastBroadcastMeta.get(busIdStr);
    let shouldBroadcast = true;
    if (meta) {
        const dt = now - meta.t;
        const dist = haversineMeters(meta.lat, meta.lng, lat, lng);
        if (dt < MIN_BROADCAST_INTERVAL_MS && dist < MIN_BROADCAST_DISTANCE_M) {
            shouldBroadcast = false;
        }
    }
    if (shouldBroadcast) {
        lastBroadcastMeta.set(busIdStr, { t: now, lat, lng });
        const io = getSocketIOServer();
        if (io) {
            io.to(`bus:${busIdStr}`).emit('bus:location', {
                busId: busIdStr,
                lat,
                lng,
                accuracy: acc,
                updatedAt: new Date().toISOString(),
            });
        }
    }

    return { ok: true, busId: busIdStr, broadcast: shouldBroadcast };
}

/** Consider bus "live" if updated within this window (ms). */
export const BUS_LOCATION_STALE_MS = 120_000;

export async function getLatestLocationForBus(busObjectId: mongoose.Types.ObjectId) {
    return BusLocation.findOne({ busId: busObjectId }).lean();
}
