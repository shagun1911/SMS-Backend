import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import User from '../models/user.model';
import ErrorResponse from '../utils/errorResponse';
import { AuthRequest, UserRole } from '../types';
import config from '../config';

/**
 * Protect routes - Verify JWT token
 */
export const protect = async (req: AuthRequest, _res: Response, next: NextFunction) => {
    let token;

    if (
        req.headers.authorization &&
        req.headers.authorization.startsWith('Bearer')
    ) {
        // Set token from Bearer token in header
        token = req.headers.authorization.split(' ')[1];
    }

    // Make sure token exists
    if (!token) {
        return next(new ErrorResponse('Not authorized to access this route', 401));
    }

    try {
        // Verify token
        const decoded: any = jwt.verify(token, config.jwt.accessSecret);

        const user = await User.findById(decoded.id);

        if (!user) {
            return next(new ErrorResponse('No user found with this id', 404));
        }

        req.user = user;
        next();
    } catch (err) {
        return next(new ErrorResponse('Not authorized to access this route', 401));
    }
};

/**
 * Grant access to specific roles
 */
export const authorize = (...roles: UserRole[]) => {
    return (req: AuthRequest, _res: Response, next: NextFunction) => {
        if (!req.user) {
            return next(new ErrorResponse('Not authorized', 401));
        }

        if (!roles.includes(req.user.role as UserRole)) {
            return next(
                new ErrorResponse(
                    `User role ${req.user.role} is not authorized to access this route`,
                    403
                )
            );
        }
        next();
    };
};

/**
 * Strict School Isolation Middleware
 * Ensures users can only access data belonging to their own school,
 * while allowing Super Admins to view all or specific school data.
 */
export const multitenant = (req: AuthRequest, _res: Response, next: NextFunction) => {
    if (!req.user) {
        return next(new ErrorResponse('Not authorized', 401));
    }

    const { role, schoolId: userSchoolId } = req.user;

    // 👑 Super Admin logic
    if (role === UserRole.SUPER_ADMIN) {
        // Super Admin can specify a schoolId in query, body, or headers to filter context
        const requestedSchoolId = (req.query.schoolId || req.body.schoolId || req.headers['x-school-id']) as string;

        if (requestedSchoolId) {
            req.schoolId = requestedSchoolId;
        } else {
            // If no schoolId specified, Super Admin sees GLOBAL (all schools)
            req.schoolId = undefined;
        }
        return next();
    }

    // 🛡 Regular User Isolation (Teacher, Accountant, School Admin)
    if (!userSchoolId) {
        return next(new ErrorResponse('User identification error: No school associated with this account', 403));
    }

    // Strictly bind to the user's school
    const currentSchoolId = userSchoolId.toString();
    req.schoolId = currentSchoolId;

    // SECURITY CHECK: If request explicitly tries to point to another school, block it
    // Check Query Params
    if (req.query.schoolId && req.query.schoolId !== currentSchoolId) {
        return next(new ErrorResponse('Security Violation: Unauthorized cross-tenant query detected', 403));
    }

    // Check Body (prevent creating/updating data for another school)
    if (req.body.schoolId && req.body.schoolId !== currentSchoolId) {
        return next(new ErrorResponse('Security Violation: Attempt to modify data for another tenant blocked', 403));
    }

    // Check URL Params
    if (req.params.schoolId && req.params.schoolId !== currentSchoolId) {
        return next(new ErrorResponse('Security Violation: Unauthorized access to specific tenant resources', 403));
    }

    // Auto-inject schoolId into body for POST/PUT requests if not present
    if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
        req.body.schoolId = currentSchoolId;
    }

    next();
};
