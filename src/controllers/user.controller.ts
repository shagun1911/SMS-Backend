import { Response, NextFunction } from 'express';
import User from '../models/user.model';
import ErrorResponse from '../utils/errorResponse';
import { AuthRequest, UserRole } from '../types';
import { checkTeacherLimit } from '../services/planLimit.service';
import { updateUsageForSchool } from '../services/usage.service';

class UserController {
    /**
     * Get all users in the current school
     */
    async getUsers(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const schoolId = req.schoolId;
            if (!schoolId) {
                return res.status(200).json({ success: true, count: 0, data: [] });
            }
            const users = await User.find({ schoolId }).sort({ role: 1, name: 1 });

            return res.status(200).json({
                success: true,
                count: users.length,
                data: users
            });
        } catch (error) {
            return next(error);
        }
    }

    /**
     * Get single user
     */
    async getUser(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const user = await User.findById(req.params.id);

            if (!user) {
                return next(new ErrorResponse(`User not found with id of ${req.params.id}`, 404));
            }

            // Ensure user belongs to the same school
            if (user.schoolId?.toString() !== req.schoolId) {
                return next(new ErrorResponse(`Not authorized to access this user`, 401));
            }

            return res.status(200).json({
                success: true,
                data: user
            });
        } catch (error) {
            return next(error);
        }
    }

    /**
     * Create user (Staff)
     */
    async createUser(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const schoolId = req.schoolId!;
            req.body.schoolId = schoolId;

            if (req.body.role === UserRole.TEACHER) {
                await checkTeacherLimit(schoolId);
            }

            if (!req.body.password) {
                req.body.password = 'Staff@123';
            }

            const user = await User.create(req.body);

            if (user.role === UserRole.TEACHER) {
                await updateUsageForSchool(schoolId);
            }

            return res.status(201).json({
                success: true,
                data: user
            });
        } catch (error) {
            return next(error);
        }
    }

    /**
     * Update user
     */
    async updateUser(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            let user = await User.findById(req.params.id);

            if (!user) {
                return next(new ErrorResponse(`User not found with id of ${req.params.id}`, 404));
            }

            // Ensure user belongs to the same school
            if (user.schoolId?.toString() !== req.schoolId) {
                return next(new ErrorResponse(`Not authorized to update this user`, 401));
            }

            const allowed = ['name', 'email', 'phone', 'subject', 'qualification', 'baseSalary', 'photo', 'isActive', 'permissions'];
            const payload: any = {};
            allowed.forEach((key) => {
                if (req.body[key] !== undefined) payload[key] = req.body[key];
            });
            if (Array.isArray(payload.permissions)) {
                payload.permissions = payload.permissions.filter((p: string) => typeof p === 'string');
            }

            const previousUser = user;
            user = await User.findByIdAndUpdate(req.params.id, payload, {
                new: true,
                runValidators: true
            });

            if (previousUser.role === UserRole.TEACHER || (user as any).role === UserRole.TEACHER) {
                await updateUsageForSchool(req.schoolId!);
            }

            return res.status(200).json({
                success: true,
                data: user
            });
        } catch (error) {
            return next(error);
        }
    }

    /**
     * Set / reset login password for a staff member (e.g. teacher). Admin only.
     */
    async setPassword(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const user = await User.findById(req.params.id).select('+password');

            if (!user) {
                return next(new ErrorResponse(`User not found with id of ${req.params.id}`, 404));
            }

            if (user.schoolId?.toString() !== req.schoolId) {
                return next(new ErrorResponse(`Not authorized to update this user`, 401));
            }

            const { password } = req.body;
            if (!password || typeof password !== 'string' || password.length < 6) {
                return next(new ErrorResponse('Password must be at least 6 characters', 400));
            }

            user.password = password;
            (user as any).mustChangePassword = true;
            await user.save();

            return res.status(200).json({
                success: true,
                message: 'Password updated. Share the new password with the staff member securely.',
            });
        } catch (error) {
            return next(error);
        }
    }

    /**
     * Delete user
     */
    async deleteUser(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const user = await User.findById(req.params.id);

            if (!user) {
                return next(new ErrorResponse(`User not found with id of ${req.params.id}`, 404));
            }

            if (user.schoolId?.toString() !== req.schoolId) {
                return next(new ErrorResponse(`Not authorized to delete this user`, 401));
            }

            const schoolId = user.schoolId?.toString();
            const wasTeacher = user.role === UserRole.TEACHER;

            await User.findByIdAndDelete(req.params.id);

            if (wasTeacher && schoolId) {
                await updateUsageForSchool(schoolId);
            }

            return res.status(200).json({
                success: true,
                data: {}
            });
        } catch (error) {
            return next(error);
        }
    }
}

export default new UserController();
