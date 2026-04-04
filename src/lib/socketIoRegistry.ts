import type { Server } from 'socket.io';

let ioInstance: Server | null = null;

export function setSocketIOServer(io: Server): void {
    ioInstance = io;
}

export function getSocketIOServer(): Server | null {
    return ioInstance;
}
