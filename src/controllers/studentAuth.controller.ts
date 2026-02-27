import { Request, Response, NextFunction } from 'express';
import Student from '../models/student.model';
import School from '../models/school.model';
import ErrorResponse from '../utils/errorResponse';
import { AuthRequest } from '../types';
import { sendResponse } from '../utils/response';
import config from '../config';
import jwt from 'jsonwebtoken';

class StudentAuthController {
    /**
     * POST /auth/student/login
     * Body: { admissionNumber, password }
     * The school is derived from the admission number prefix (e.g. "DPS260001" → school code "DPS")
     */
    async login(req: Request, res: Response, next: NextFunction) {
        try {
            const { admissionNumber, password } = req.body;

            if (!admissionNumber || !password) {
                return next(new ErrorResponse('Please provide admission number and password', 400));
            }

            const admNo = admissionNumber.trim().toUpperCase();

            // Find the student by admission number across all schools (admission numbers are globally unique per school code prefix)
            const student = await Student.findOne({
                admissionNumber: admNo,
                isActive: true,
            }).select('+password');

            if (!student) {
                return next(new ErrorResponse('Invalid admission number or password', 401));
            }

            // Load the school for the response payload
            const school = await School.findById(student.schoolId);
            if (!school || !school.isActive) {
                return next(new ErrorResponse('School account is inactive', 403));
            }

            // If student has no password yet (created before this feature),
            // auto-initialize their DOB-based default password on first login attempt
            if (!student.password) {
                if (student.dateOfBirth) {
                    const dob = new Date((student as any).dateOfBirth);
                    const dd = String(dob.getDate()).padStart(2, '0');
                    const mm = String(dob.getMonth() + 1).padStart(2, '0');
                    const yyyy = dob.getFullYear();
                    const dobPassword = `${dd}${mm}${yyyy}`;

                    if (password !== dobPassword) {
                        return next(new ErrorResponse('Invalid admission number or password', 401));
                    }

                    // Set the hashed password now so future logins go through bcrypt
                    student.password = dobPassword;
                    student.mustChangePassword = true;
                } else {
                    return next(new ErrorResponse('Invalid admission number or password', 401));
                }
            } else {
                const isMatch = await student.matchPassword(password);
                if (!isMatch) {
                    return next(new ErrorResponse('Invalid admission number or password', 401));
                }
            }

            // Update last login
            student.lastLogin = new Date();
            await student.save({ validateBeforeSave: false });

            const accessToken = student.getSignedJwtToken();
            // Refresh token for student
            const refreshToken = jwt.sign(
                { id: student._id.toString(), userType: 'student' },
                config.jwt.refreshSecret as any,
                { expiresIn: config.jwt.refreshExpire as any }
            );

            return res.status(200).json({
                success: true,
                accessToken,
                refreshToken,
                mustChangePassword: student.mustChangePassword,
                student: {
                    _id: student._id,
                    firstName: student.firstName,
                    lastName: student.lastName,
                    admissionNumber: student.admissionNumber,
                    class: student.class,
                    section: student.section,
                    photo: student.photo,
                    schoolId: student.schoolId,
                    schoolCode: school.schoolCode,
                    schoolName: school.schoolName,
                    mustChangePassword: student.mustChangePassword,
                },
            });
        } catch (error) {
            next(error);
        }
    }

    /**
     * GET /auth/student/me — requires student JWT
     */
    async getMe(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const student = await Student.findById(req.student!._id).populate('schoolId', 'schoolName schoolCode logo');
            if (!student) return next(new ErrorResponse('Student not found', 404));
            return sendResponse(res, student, 'Student profile', 200);
        } catch (error) {
            next(error);
        }
    }

    /**
     * POST /auth/student/change-password — requires student JWT
     * Body: { currentPassword, newPassword }
     */
    async changePassword(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const { currentPassword, newPassword } = req.body;
            if (!currentPassword || !newPassword) {
                return next(new ErrorResponse('Please provide current and new password', 400));
            }
            if (newPassword.length < 6) {
                return next(new ErrorResponse('New password must be at least 6 characters', 400));
            }

            const student = await Student.findById(req.student!._id).select('+password');
            if (!student) return next(new ErrorResponse('Student not found', 404));

            // Handle legacy students with no stored password (verify against DOB)
            let isMatch = false;
            if (!student.password) {
                const dob = new Date((student as any).dateOfBirth);
                const dd = String(dob.getDate()).padStart(2, '0');
                const mm = String(dob.getMonth() + 1).padStart(2, '0');
                const yyyy = dob.getFullYear();
                isMatch = currentPassword === `${dd}${mm}${yyyy}`;
            } else {
                isMatch = await student.matchPassword(currentPassword);
            }

            if (!isMatch) {
                return next(new ErrorResponse('Current password is incorrect', 401));
            }

            student.password = newPassword;
            student.mustChangePassword = false;
            await student.save();

            return sendResponse(res, {}, 'Password changed successfully', 200);
        } catch (error) {
            next(error);
        }
    }
}

export default new StudentAuthController();
