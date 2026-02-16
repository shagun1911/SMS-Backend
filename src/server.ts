import express, { Request, Response } from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import compression from 'compression';
import cookieParser from 'cookie-parser';

// Internal modules
import config from './config';
import connectDB from './config/database';
import apiRoutes from './routes';
import healthRoutes from './routes/health.routes';
import errorHandler from './middleware/error.middleware';
import { seedSystem } from './utils/seeder';

// Load env vars
dotenv.config();

// Initialize app
const app = express();

// Connect to database and seed
connectDB().then(() => {
    seedSystem();
});

// ============================================
// MIDDLEWARE
// ============================================

// Security headers
app.use(helmet());

// CORS – allow multiple origins (e.g. localhost:3000 and 3001)
app.use(
    cors({
        origin: (config.frontend as any).origins?.length
            ? (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => {
                const allowed = (config.frontend as any).origins as string[];
                if (!origin || allowed.includes(origin)) cb(null, true);
                else cb(null, false);
            }
            : config.frontend.url,
        credentials: true,
    })
);

// Body parser
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// Cookie parser
app.use(cookieParser());

// Compression
app.use(compression());

// Rate limiting
const limiter = rateLimit({
    windowMs: config.rateLimit.windowMs,
    max: config.rateLimit.maxRequests,
    message: 'Too many requests from this IP, please try again later.',
});
app.use('/api', limiter);

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
// SERVER START
// ============================================

const PORT = config.port || 5000;

const server = app.listen(PORT, () => {
    const geminiStatus = config.gemini?.apiKey ? 'configured' : 'not set';
    console.log(`
  ╔═══════════════════════════════════════════════════════╗
  ║                                                       ║
  ║   🚀 SSMS - Shagun School Management System         ║
  ║                                                       ║
  ║   🌍 Environment: ${config.env}                    ║
  ║   📡 Port: ${PORT}                                   ║
  ║   🔗 API: http://localhost:${PORT}/api/v1              ║
  ║   🤖 Gemini: ${geminiStatus.padEnd(10)}                       ║
  ║                                                       ║
  ╚═══════════════════════════════════════════════════════╝
  `);
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
