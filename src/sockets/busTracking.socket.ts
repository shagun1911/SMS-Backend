import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import config from '../config';
import User from '../models/user.model';
import Student from '../models/student.model';
import Bus from '../models/bus.model';
import BusLocation from '../models/busLocation.model';
import { UserRole } from '../types';
import { applyCrewLocationUpdate, BUS_LOCATION_STALE_MS } from '../services/busLiveLocation.service';

type SocketData = {
    kind: 'crew' | 'student' | 'manager';
    busId: string;
    userId?: string;
    studentId?: string;
    role?: string;
    schoolId?: mongoose.Types.ObjectId;
};

function parseToken(socket: Socket): string | null {
    const a = socket.handshake.auth;
    if (a && typeof a.token === 'string' && a.token.trim()) {
        return a.token.replace(/^Bearer\s+/i, '').trim();
    }
    const h = socket.handshake.headers.authorization;
    if (typeof h === 'string' && h.startsWith('Bearer ')) {
        return h.slice(7).trim();
    }
    return null;
}

export function attachBusTrackingSocket(io: Server): void {
    io.use(async (socket, next) => {
        const token = parseToken(socket);
        if (!token) {
            return next(new Error('AUTH_REQUIRED'));
        }
        try {
            const decoded = jwt.verify(token, config.jwt.accessSecret) as {
                id: string;
                userType?: string;
                role?: string;
                schoolId?: string;
            };

            if (decoded.userType === 'student' || decoded.role === 'student') {
                const student = await Student.findById(decoded.id)
                    .select('usesTransport busId schoolId isActive')
                    .lean();
                if (!student?.isActive || !student.usesTransport || !student.busId) {
                    return next(new Error('STUDENT_NO_BUS'));
                }
                (socket.data as SocketData).kind = 'student';
                (socket.data as SocketData).busId = String(student.busId);
                (socket.data as SocketData).studentId = String(student._id);
                return next();
            }

            const user = await User.findById(decoded.id).select('role schoolId').lean();
            if (!user) {
                return next(new Error('USER_NOT_FOUND'));
            }
            const role = user.role as UserRole;
            const schoolId = user.schoolId as mongoose.Types.ObjectId | undefined;

            if (role === UserRole.TRANSPORT_MANAGER) {
                (socket.data as SocketData).kind = 'manager' as any;
                (socket.data as SocketData).userId = String(user._id);
                (socket.data as SocketData).role = role;
                (socket.data as SocketData).schoolId = schoolId;
                return next();
            }

            if (role !== UserRole.BUS_DRIVER && role !== UserRole.CONDUCTOR) {
                return next(new Error('NOT_CREW'));
            }
            const bus = await Bus.findOne({
                schoolId,
                isActive: true,
                $or: [{ driverUserId: user._id }, { conductorUserId: user._id }],
            })
                .select('_id')
                .lean();
            if (!bus?._id) {
                return next(new Error('NO_BUS_ASSIGNMENT'));
            }
            (socket.data as SocketData).kind = 'crew';
            (socket.data as SocketData).busId = String(bus._id);
            (socket.data as SocketData).userId = String(user._id);
            (socket.data as SocketData).role = role;
            (socket.data as SocketData).schoolId = schoolId;
            return next();
        } catch (error: any) {
            console.error('[Socket Auth] Verification failed:', error.message);
            return next(new Error(`AUTH_INVALID: ${error.message}`));
        }
    });

    io.on('connection', (socket: Socket) => {
        const data = socket.data as SocketData & { kind: 'crew' | 'student' | 'manager' };

        if (data.kind === 'manager') {
            const room = `school:${data.schoolId}:buses`;
            socket.join(room);
        } else {
            const room = `bus:${data.busId}`;
            socket.join(room);
        }

        if (data.kind === 'student') {
            BusLocation.findOne({ busId: new mongoose.Types.ObjectId(data.busId) })
                .lean()
                .then((doc) => {
                    if (!doc) {
                        socket.emit('bus:location:sync', {
                            location: null,
                            staleAfterMs: BUS_LOCATION_STALE_MS,
                        });
                        return;
                    }
                    const age = Date.now() - new Date(doc.updatedAt).getTime();
                    socket.emit('bus:location:sync', {
                        location: {
                            lat: doc.lat,
                            lng: doc.lng,
                            accuracy: doc.accuracy,
                            updatedAt: doc.updatedAt,
                        },
                        staleAfterMs: BUS_LOCATION_STALE_MS,
                        offline: age > BUS_LOCATION_STALE_MS,
                    });
                })
                .catch(() => {
                    socket.emit('bus:location:sync', { location: null, staleAfterMs: BUS_LOCATION_STALE_MS });
                });
        }

        socket.on('bus:location:update', async (payload: { lat?: unknown; lng?: unknown; accuracy?: unknown }) => {
            if (data.kind !== 'crew' || !data.userId || !data.role) {
                socket.emit('bus:location:error', { code: 'FORBIDDEN', message: 'Only assigned crew can send location.' });
                return;
            }
            const result = await applyCrewLocationUpdate({
                userId: new mongoose.Types.ObjectId(data.userId),
                schoolId: data.schoolId,
                role: data.role,
                lat: payload?.lat,
                lng: payload?.lng,
                accuracy: payload?.accuracy,
            });
            if (!result.ok) {
                socket.emit('bus:location:error', { code: result.reason, message: result.reason });
                return;
            }
            socket.emit('bus:location:ack', { ok: true });
        });

        socket.on('disconnect', () => {
            if (data.kind === 'manager') {
                socket.leave(`school:${data.schoolId}:buses`);
            } else {
                socket.leave(`bus:${data.busId}`);
            }
        });
    });
}
