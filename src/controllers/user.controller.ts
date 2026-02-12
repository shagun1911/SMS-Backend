import { Response, NextFunction } from 'express';
import User from '../models/user.model';
import ErrorResponse from '../utils/errorResponse';
import { AuthRequest } from '../types';

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
            const schoolId = req.schoolId;
            req.body.schoolId = schoolId;

            // Default password if not provided
            if (!req.body.password) {
                req.body.password = 'Staff@123';
            }

            const user = await User.create(req.body);

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

            user = await User.findByIdAndUpdate(req.params.id, req.body, {
                new: true,
                runValidators: true
            });

            return res.status(200).json({
                success: true,
                data: user
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

            // Ensure user belongs to the same school
            if (user.schoolId?.toString() !== req.schoolId) {
                return next(new ErrorResponse(`Not authorized to delete this user`, 401));
            }

            await User.findByIdAndDelete(req.params.id);

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
