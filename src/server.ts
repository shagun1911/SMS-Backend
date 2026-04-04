import express, { Request, Response, NextFunction } from 'express';
import http from 'http';
import { Server } from 'socket.io';
import dotenv from 'dotenv';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import mongoSanitize from 'express-mongo-sanitize';

// Internal modules
import config from './config';
import connectDB from './config/database';
import apiRoutes from './routes';
import healthRoutes from './routes/health.routes';
import errorHandler from './middleware/error.middleware';
import { seedSystem } from './utils/seeder';
import { migrateStudentUsernames } from './utils/migrations';
import * as paymentController from './controllers/payment.controller';
import { setSocketIOServer } from './lib/socketIoRegistry';
import { attachBusTrackingSocket } from './sockets/busTracking.socket';

// Load env vars
dotenv.config();

// Initialize app
const app = express();

// Trust proxy (required when behind Render, Nginx, etc. so rate-limit and IP detection work)
app.set('trust proxy', 1);

// ============================================
// MIDDLEWARE
// ============================================

// Security headers (configured for API + Vercel frontend)
app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: false,
}));

//CORS – allow configured origins plus *.vercel.app for Vercel deployments
app.use(
    cors({
        origin: (config.frontend as any).origins?.length
            ? (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => {
                const allowed = (config.frontend as any).origins as string[];
                if (!origin) return cb(null, true);
                if (allowed.includes(origin)) return cb(null, true);
                if (/^https:\/\/[\w-]+\.vercel\.app$/.test(origin)) return cb(null, true);
                cb(null, false);
            }
            : config.frontend.url,
        credentials: true,
    })
);
 //app.use(cors({ origin: "*" }));

// Razorpay webhook – must use raw body for signature verification (before express.json)
app.use(
    '/api/v1/payments/webhook',
    express.raw({ type: 'application/json', limit: '64kb' }),
    paymentController.razorpayWebhook
);

// Body parser (homework + attachments can include long text or data URLs when Cloudinary is off)
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Cookie parser
app.use(cookieParser());

// NoSQL injection prevention — strips $ and . from req.body, req.query, req.params
app.use(mongoSanitize());

// XSS prevention — strip dangerous HTML tags from string inputs
function sanitizeStrings(obj: any): any {
    if (typeof obj === 'string') {
        return obj.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
            .replace(/on\w+\s*=\s*["'][^"']*["']/gi, '')
            .replace(/javascript\s*:/gi, '');
    }
    if (Array.isArray(obj)) return obj.map(sanitizeStrings);
    if (obj && typeof obj === 'object') {
        const cleaned: any = {};
        for (const key of Object.keys(obj)) {
            cleaned[key] = sanitizeStrings(obj[key]);
        }
        return cleaned;
    }
    return obj;
}

app.use((req: Request, _res: Response, next: NextFunction) => {
    if (req.body && typeof req.body === 'object') req.body = sanitizeStrings(req.body);
    next();
});

// Compression
app.use(compression());

// General API rate limiting (100 requests per 15 minutes)
const limiter = rateLimit({
    windowMs: config.rateLimit.windowMs,
    max: config.rateLimit.maxRequests,
    message: { success: false, message: 'Too many requests from this IP, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
});
app.use('/api', limiter);

// Strict rate limit on auth routes (20 attempts per 15 minutes per IP)
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    message: { success: false, message: 'Too many login attempts. Please try again after 15 minutes.' },
    standardHeaders: true,
    legacyHeaders: false,
});
app.use('/api/v1/auth/login', authLimiter);
app.use('/api/v1/auth/register', authLimiter);

// ============================================
// ROUTES
// ============================================

// Health check
app.use('/health', healthRoutes);

// API v1 routes
app.use('/api/v1', apiRoutes);

// 404 handler
app.use((req: Request, res: Response) => {
    res.status(404).json({
        success: false,
        message: `Not Found - ${req.originalUrl}`,
    });
});

// Error handler (must be last middleware)
app.use(errorHandler);

// ============================================
// SERVER START – bind port first (required by Render), then connect DB
// ============================================

const PORT = config.port || 5000;

const httpServer = http.createServer(app);

const io = new Server(httpServer, {
    path: '/socket.io',
    cors: {
        origin: true,
        credentials: true,
        methods: ['GET', 'POST'],
    },
    pingTimeout: 60000,
    pingInterval: 25000,
});

setSocketIOServer(io);
attachBusTrackingSocket(io);

// Bind to 0.0.0.0 so the service is reachable on Render's assigned PORT
const server = httpServer.listen(PORT, '0.0.0.0', () => {
    const geminiStatus = config.gemini?.apiKey ? 'configured' : 'not set';
    console.log(`
  ╔═══════════════════════════════════════════════════════╗
  ║                                                       ║
  ║   🚀 SMS - School Management System                   ║
  ║                                                       ║
  ║   🌍 Environment: ${config.env}                    ║
  ║   📡 Port: ${PORT}                                   ║
  ║   🔗 API: http://localhost:${PORT}/api/v1              ║
  ║   🔌 Socket.IO: same host, path /socket.io           ║
  ║   🤖 Gemini: ${geminiStatus.padEnd(10)}                       ║
  ║                                                       ║
  ╚═══════════════════════════════════════════════════════╝
  `);
    // Connect DB and seed after port is bound (so Render port scan succeeds)
    connectDB().then(async () => {
        await seedSystem();
        await migrateStudentUsernames();
    }).catch((err) => {
        console.error('Database connection failed:', err.message);
    });
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (err: Error) => {
    console.log('UNHANDLED REJECTION! 💥 Shutting down...');
    console.log(err.name, err.message);
    server.close(() => {
        process.exit(1);
    });
});

// Handle uncaught exceptions
process.on('uncaughtException', (err: Error) => {
    console.log('UNCAUGHT EXCEPTION! 💥 Shutting down...');
    console.log(err.name, err.message);
    process.exit(1);
});
