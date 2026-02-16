import { Request, Response, NextFunction } from 'express';
import ErrorResponse from '../utils/errorResponse';
import config from '../config';

const errorHandler = (err: any, req: Request, res: Response, _next: NextFunction) => {
    const origin = req.get('origin');
    const allowed = (config.frontend as any).origins as string[] | undefined;
    const allowOrigin = origin && (
        (allowed?.length && allowed.includes(origin)) ||
        /^https:\/\/[\w-]+\.vercel\.app$/.test(origin)
    );
    if (allowOrigin) {
        res.setHeader('Access-Control-Allow-Origin', origin!);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
    let error = { ...err };

    error.message = err.message;

    // Log to console for dev (skip full stack for expected 401 Unauthorized)
    if (err.statusCode === 401) {
        console.log(`[401] ${err.message}`);
    } else {
        console.log(err);
    }

    // Mongoose bad ObjectId
    if (err.name === 'CastError') {
        const message = `Resource not found with id of ${err.value}`;
        error = new ErrorResponse(message, 404);
    }

    // Mongoose duplicate key
    if (err.code === 11000) {
        const message = 'Duplicate field value entered';
        error = new ErrorResponse(message, 400);
    }

    // Mongoose validation error
    if (err.name === 'ValidationError') {
        const message = Object.values(err.errors).map((val: any) => val.message).join(', ');
        error = new ErrorResponse(message, 400);
    }

    res.status(error.statusCode || 500).json({
        success: false,
        message: error.message || 'Server Error',
    });
};

export default errorHandler;
