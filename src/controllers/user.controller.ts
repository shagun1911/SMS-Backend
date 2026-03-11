import { Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import User from '../models/user.model';
import Salary from '../models/salary.model';
import SalaryStructure from '../models/salaryStructure.model';
import OtherPayment from '../models/otherPayment.model';
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

            // Backfill plainPassword for users that don't have it yet
            const needsBackfill = users.filter(u => !u.plainPassword);
            if (needsBackfill.length > 0) {
                const withHash = await User.find({
                    _id: { $in: needsBackfill.map(u => u._id) },
                }).select('+password');

                for (const u of withHash) {
                    const firstName = (u.name || '').split(' ')[0].toLowerCase() || 'staff';
                    const phoneLast4 = (u.phone || '').slice(-4) || '1234';
                    const defaultPwd = firstName + phoneLast4;
                    const matches = await bcrypt.compare(defaultPwd, u.password);
                    if (matches) {
                        await User.updateOne({ _id: u._id }, { plainPassword: defaultPwd });
                        const original = users.find(x => x._id.toString() === u._id.toString());
                        if (original) (original as any).plainPassword = defaultPwd;
                    }
                }
            }

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

            // Check staff limit for ALL staff roles (teachers, accountants, transport managers, admins)
            const isStaffRole = [UserRole.TEACHER, UserRole.ACCOUNTANT, UserRole.TRANSPORT_MANAGER, UserRole.SCHOOL_ADMIN].includes(req.body.role);
            if (isStaffRole) {
                await checkTeacherLimit(schoolId);
            }

            if (!req.body.password) {
                const firstName = (req.body.name || '').split(' ')[0].toLowerCase() || 'staff';
                const phoneLast4 = (req.body.phone || '').slice(-4) || '1234';
                req.body.password = firstName + phoneLast4;
            }
            req.body.plainPassword = req.body.password;

            const user = await User.create(req.body);

            if (isStaffRole) {
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

            const allowed = ['name', 'email', 'phone', 'subject', 'qualification', 'joiningDate', 'baseSalary', 'photo', 'isActive', 'permissions'];
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

            let { password } = req.body;

            // If No password provided (shouldn't happen with modern UI, but for safety)
            if (!password) {
                const firstName = (user.name || '').split(' ')[0].toLowerCase() || 'staff';
                const phoneLast4 = (user.phone || '').slice(-4) || '1234';
                password = firstName + phoneLast4;
            }

            if (typeof password !== 'string' || password.length < 6) {
                return next(new ErrorResponse('Password must be at least 6 characters', 400));
            }

            user.password = password;
            (user as any).plainPassword = password;
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
            const staffId = user._id;

            // Cascade delete all records related to this staff member
            await Promise.all([
                Salary.deleteMany({ staffId }),
                SalaryStructure.deleteMany({ staffId }),
                OtherPayment.deleteMany({ staffId }),
            ]);

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
