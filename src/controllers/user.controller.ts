import { Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import User from '../models/user.model';
import ErrorResponse from '../utils/errorResponse';
import { AuthRequest, UserRole } from '../types';
import { checkTeacherLimit } from '../services/planLimit.service';
import { updateUsageForSchool } from '../services/usage.service';
import CascadeDeleteService from '../services/cascadeDelete.service';
import {
    isMongoDuplicateUsernameError,
    parseAndValidateStaffPhone,
} from '../utils/staffPhone';

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

            // Super admin without a scoped school sees all tenants (master console use-case).
            if (req.user!.role === UserRole.SUPER_ADMIN && !req.schoolId) {
                return res.status(200).json({
                    success: true,
                    data: user,
                });
            }

            if (!req.schoolId) {
                return next(new ErrorResponse('School context required', 403));
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

            const staffRolesForLimit: UserRole[] = [
                UserRole.TEACHER,
                UserRole.ACCOUNTANT,
                UserRole.TRANSPORT_MANAGER,
                UserRole.SCHOOL_ADMIN,
                UserRole.BUS_DRIVER,
                UserRole.CONDUCTOR,
                UserRole.CLEANING_STAFF,
                UserRole.STAFF_OTHER,
            ];
            const isStaffRole = staffRolesForLimit.includes(req.body.role);
            if (isStaffRole) {
                await checkTeacherLimit(schoolId);
            }

            if (req.body.role === UserRole.SUPER_ADMIN) {
                return next(new ErrorResponse('Super admin accounts cannot be created from this route', 403));
            }

            const role = req.body.role as UserRole;
            const emailRaw = String(req.body.email ?? '')
                .trim()
                .toLowerCase();
            const emailPattern = /^\S+@\S+\.\S+$/;
            const emailNormalized = emailRaw === 'undefined' || emailRaw === 'null' ? '' : emailRaw;

            if (role === UserRole.SCHOOL_ADMIN) {
                if (!emailNormalized || !emailPattern.test(emailNormalized)) {
                    return next(
                        new ErrorResponse(
                            'A valid email address is required for school admin accounts',
                            400
                        )
                    );
                }
                req.body.email = emailNormalized;
            } else if (emailNormalized === '') {
                delete req.body.email;
            } else if (!emailPattern.test(emailNormalized)) {
                return next(new ErrorResponse('Please provide a valid email address', 400));
            } else {
                req.body.email = emailNormalized;
            }

            if (req.body.role === UserRole.STAFF_OTHER) {
                const title = String(req.body.staffRoleTitle || '').trim();
                if (title.length < 2) {
                    return next(new ErrorResponse('Please enter a specific role for "Other"', 400));
                }
                req.body.staffRoleTitle = title;
            } else {
                req.body.staffRoleTitle = undefined;
            }

            const nameTrim = String(req.body.name ?? '').trim();
            if (nameTrim.length < 3) {
                return next(new ErrorResponse('Please provide a full name (at least 3 characters)', 400));
            }
            req.body.name = nameTrim;

            const phoneRaw = String(req.body.phone ?? '').trim();
            if (!phoneRaw) {
                return next(new ErrorResponse('Phone number is required', 400));
            }
            let normalizedPhone: string;
            try {
                normalizedPhone = parseAndValidateStaffPhone(phoneRaw);
            } catch (e) {
                return next(e as Error);
            }
            req.body.phone = normalizedPhone;
            req.body.username = normalizedPhone;
            const existingByUsername = await User.findOne({ username: normalizedPhone })
                .select('_id')
                .lean();
            if (existingByUsername) {
                return next(
                    new ErrorResponse('This phone number is already registered for another staff user', 409)
                );
            }

            if (req.body.role === UserRole.TEACHER) {
                const sub = String(req.body.subject ?? '').trim();
                if (sub.length < 1) {
                    return next(new ErrorResponse('Primary subject / specialization is required for teachers', 400));
                }
                req.body.subject = sub;
            } else {
                delete req.body.subject;
            }

            const bs = req.body.baseSalary;
            if (req.body.role !== UserRole.SCHOOL_ADMIN) {
                if (bs === '' || bs == null || Number.isNaN(Number(bs))) {
                    return next(new ErrorResponse('Base salary is required', 400));
                }
                req.body.baseSalary = Number(bs);
            } else if (bs === '' || bs == null || Number.isNaN(Number(bs))) {
                req.body.baseSalary = 0;
            } else {
                req.body.baseSalary = Number(bs);
            }

            if (!req.body.joiningDate) {
                return next(new ErrorResponse('Joining date is required', 400));
            }

            if (!req.body.password) {
                const firstName =
                    (req.body.name || '').split(' ')[0].toLowerCase().replace(/[^a-z0-9]/g, '') || 'staff';
                const phoneLast4 = normalizedPhone.slice(-4);
                let pwd = `${firstName}${phoneLast4}`;
                if (pwd.length < 6) {
                    pwd = `${firstName}123456`.slice(0, 24);
                }
                req.body.password = pwd;
            }
            req.body.plainPassword = req.body.password;

            let user;
            try {
                user = await User.create(req.body);
            } catch (err) {
                if (isMongoDuplicateUsernameError(err)) {
                    return next(
                        new ErrorResponse(
                            'This phone number is already registered for another staff user',
                            409
                        )
                    );
                }
                const dup = err as {
                    code?: number;
                    message?: string;
                    keyPattern?: Record<string, unknown>;
                };
                if (dup?.code === 11000) {
                    const keyPattern = dup.keyPattern || {};
                    if (Object.prototype.hasOwnProperty.call(keyPattern, 'email')) {
                        return next(new ErrorResponse('This email is already registered', 409));
                    }
                    if (Object.prototype.hasOwnProperty.call(keyPattern, 'username')) {
                        return next(
                            new ErrorResponse(
                                'This phone number is already registered for another staff user',
                                409
                            )
                        );
                    }
                    if (
                        String(dup.message || '')
                            .toLowerCase()
                            .includes('email')
                    ) {
                        return next(new ErrorResponse('This email is already registered', 409));
                    }
                    if (
                        String(dup.message || '')
                            .toLowerCase()
                            .includes('username')
                    ) {
                        return next(
                            new ErrorResponse(
                                'This phone number is already registered for another staff user',
                                409
                            )
                        );
                    }
                }
                throw err;
            }

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

            const allowed = [
                'name',
                'email',
                'phone',
                'subject',
                'staffRoleTitle',
                'qualification',
                'joiningDate',
                'baseSalary',
                'photo',
                'isActive',
                'permissions',
            ];
            const payload: any = {};
            allowed.forEach((key) => {
                if (req.body[key] !== undefined) payload[key] = req.body[key];
            });
            if (Array.isArray(payload.permissions)) {
                payload.permissions = payload.permissions.filter((p: string) => typeof p === 'string');
            }

            if (payload.email !== undefined) {
                const er = String(payload.email || '').trim();
                payload.email = er === '' ? undefined : er.toLowerCase();
            }

            if (payload.phone !== undefined) {
                const normalizedPhone = parseAndValidateStaffPhone(String(payload.phone));
                payload.phone = normalizedPhone;
                payload.username = normalizedPhone;
                const taken = await User.findOne({
                    username: normalizedPhone,
                    _id: { $ne: req.params.id },
                })
                    .select('_id')
                    .lean();
                if (taken) {
                    return next(
                        new ErrorResponse(
                            'This phone number is already registered for another staff user',
                            409
                        )
                    );
                }
            }

            const previousUser = user;
            try {
                user = await User.findByIdAndUpdate(req.params.id, payload, {
                    new: true,
                    runValidators: true,
                });
            } catch (err) {
                if (isMongoDuplicateUsernameError(err)) {
                    return next(
                        new ErrorResponse(
                            'This phone number is already registered for another staff user',
                            409
                        )
                    );
                }
                throw err;
            }

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

            if (user.role === UserRole.SUPER_ADMIN) {
                return next(new ErrorResponse('Cannot delete platform super admin', 403));
            }

            await CascadeDeleteService.deleteStaffCascade(req.schoolId!, req.params.id);

            return res.status(200).json({
                success: true,
                data: {}
            });
        } catch (error) {
            return next(error);
        }
    }

    /**
     * Delete staff by explicit staffId route alias
     */
    async deleteStaff(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            await CascadeDeleteService.deleteStaffCascade(req.schoolId!, req.params.staffId);
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
