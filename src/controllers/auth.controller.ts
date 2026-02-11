import { Request, Response, NextFunction } from 'express';
import AuthService from '../services/auth.service';
import User from '../models/user.model';
import ErrorResponse from '../utils/errorResponse';
import { UserRole } from '../types';

class AuthController {
    /**
     * Register a new user
     */
    async register(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { name, email, password, role, schoolId } = req.body;

            // Basic validation
            if (!name || !email || !password || !role) {
                return next(new ErrorResponse('Please provide all fields', 400));
            }

            // Check if user already exists
            const existingUser = await User.findOne({ email });
            if (existingUser) {
                return next(new ErrorResponse('Email already registered', 400));
            }

            // Create user
            const result = await AuthService.register({
                name,
                email,
                password,
                role: role as UserRole,
                schoolId, // Optional for super admin
            });

            res.status(201).json({
                success: true,
                data: result,
            });
        } catch (error) {
            next(error);
        }
    }

    /**
     * Login user
     */
    async login(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { email, password, portal } = req.body;

            if (!email || !password) {
                return next(new ErrorResponse('Please provide email and password', 400));
            }

            const { user, tokens } = await AuthService.login(email, password);

            // Role vs Portal Validation
            if (portal === 'master' && user.role !== UserRole.SUPER_ADMIN) {
                return next(new ErrorResponse('Unauthorized: This portal is for Master Admins only', 403));
            }

            if (portal === 'school' && user.role === UserRole.SUPER_ADMIN) {
                return next(new ErrorResponse('Unauthorized: Master Admins must use the Control Center', 403));
            }

            // Determine redirect path based on role
            let redirectTo = '/school/dashboard';
            if (user.role === UserRole.SUPER_ADMIN) {
                redirectTo = '/master/dashboard';
            }

            res.status(200).json({
                success: true,
                accessToken: tokens.accessToken,
                refreshToken: tokens.refreshToken,
                role: user.role,
                redirectTo,
                user: {
                    _id: user._id,
                    name: user.name,
                    email: user.email,
                    role: user.role,
                    schoolId: user.schoolId
                },
            });
        } catch (error) {
            next(error);
        }
    }

    /**
     * Get current logged in user
     */
    async getMe(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const user = await User.findById((req as any).user.id);

            res.status(200).json({
                success: true,
                data: user,
            });
        } catch (error) {
            next(error);
        }
    }

    /**
     * Logout user
     */
    async logout(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            await AuthService.logout((req as any).user.id);

            res.status(200).json({
                success: true,
                data: {},
            });
        } catch (error) {
            next(error);
        }
    }

    /**
   * Refresh Token
   */
    async refreshToken(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { refreshToken } = req.body;

            if (!refreshToken) {
                return next(new ErrorResponse('Please provide refresh token', 400));
            }

            const { tokens } = await AuthService.refreshAuth(refreshToken);

            res.status(200).json({
                success: true,
                token: tokens.accessToken,
                refreshToken: tokens.refreshToken,
            });
        } catch (error) {
            next(error);
        }
    }
}

export default new AuthController();
