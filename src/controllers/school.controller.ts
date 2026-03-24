import { Request, Response, NextFunction } from 'express';
import SchoolService from '../services/school.service';
import { sendResponse } from '../utils/response';
import { AuthRequest, UserRole } from '../types';
import Student from '../models/student.model';
import User from '../models/user.model';
import StudentFee from '../models/studentFee.model';
import Class from '../models/class.model';
import School from '../models/school.model';
import { getPlanLimitsForSchool, getUsageForSchool } from '../services/planLimit.service';
import Plan from '../models/plan.model';
import { Types } from 'mongoose';
import CascadeDeleteService from '../services/cascadeDelete.service';

class SchoolController {
    /**
     * Register School
     */
    async register(req: Request, res: Response, next: NextFunction) {
        try {
            const { school, admin } = req.body;
            const result = await SchoolService.registerSchool(school, admin);
            sendResponse(res, result, 'School registered successfully', 201);
        } catch (error) {
            next(error);
        }
    }

    /**
     * Get Current School
     */
    async getMySchool(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const school = await SchoolService.getSchoolById(req.schoolId!);
            sendResponse(res, school, 'School details retrieved', 200);
        } catch (error) {
            next(error);
        }
    }

    /**
     * Update School
     */
    async updateMySchool(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const school = await SchoolService.updateSchool(req.schoolId!, req.body);
            sendResponse(res, school, 'School updated successfully', 200);
        } catch (error) {
            next(error);
        }
    }

    /**
     * Public: Get basic school info by school code (for student portal logo)
     * GET /schools/public/:code
     */
    async getPublicByCode(req: Request, res: Response, next: NextFunction) {
        try {
            const code = (req.params.code || '').toString().toUpperCase();
            const school = await School.findOne({ schoolCode: code }).select('schoolName schoolCode logo');
            if (!school) {
                return sendResponse(res, null, 'School not found', 404);
            }
            return sendResponse(res, school, 'OK', 200);
        } catch (error) {
            next(error);
        }
    }

    /**
     * Get School Dashboard Stats
     */
    async getDashboardStats(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const schoolId = req.schoolId;

            // Get last 6 months for the chart
            const last6Months = Array.from({ length: 6 }, (_, i) => {
                const d = new Date();
                d.setMonth(d.getMonth() - i);
                return d.toLocaleString('default', { month: 'short' });
            }).reverse();

            const [
                totalStudents,
                activeStaff,
                monthlyCollection,
                pendingFees,
                monthlyTrends,
                totalClasses,
                classList,
                genderAgg,
                feeStats
            ] = await Promise.all([
                Student.countDocuments({ schoolId, isActive: true }),
                User.countDocuments({ schoolId, isActive: true, role: { $ne: UserRole.SUPER_ADMIN } }),
                StudentFee.aggregate([
                    { $match: { schoolId: new Types.ObjectId(schoolId), status: 'paid' } },
                    { $group: { _id: null, total: { $sum: '$paidAmount' } } }
                ]),
                StudentFee.aggregate([
                    { $match: { schoolId: new Types.ObjectId(schoolId), status: { $in: ['pending', 'partial'] } } },
                    { $group: { _id: null, total: { $sum: '$remainingAmount' }, count: { $sum: 1 } } }
                ]),
                StudentFee.aggregate([
                    { $match: { schoolId: new Types.ObjectId(schoolId), status: 'paid' } },
                    { $group: { _id: '$month', total: { $sum: '$paidAmount' } } }
                ]),
                Class.countDocuments({ schoolId, isActive: true }),
                Class.find({ schoolId, isActive: true }),
                Student.aggregate([
                    { $match: { schoolId: new Types.ObjectId(schoolId), isActive: true } },
                    { $group: { _id: '$gender', count: { $sum: 1 } } }
                ]),
                StudentFee.aggregate([
                    { $match: { schoolId: new Types.ObjectId(schoolId) } },
                    {
                        $group: {
                            _id: null,
                            collected: { $sum: '$paidAmount' },
                            total: { $sum: { $add: ['$paidAmount', '$remainingAmount'] } }
                        }
                    }
                ])
            ]);

            const totalSections = classList?.length ?? 0;

            // Modern, dynamic gender ratio (case-insensitive)
            const genderRatio: Record<string, number> = {};
            genderAgg?.forEach((g: any) => {
                const label = g._id ? (g._id.charAt(0).toUpperCase() + g._id.slice(1).toLowerCase()) : 'Other';
                genderRatio[label] = (genderRatio[label] || 0) + g.count;
            });

            // Ensure Male/Female at least exist for frontend compatibility if desired, 
            // but the new dynamic chart will handle whatever is returned.
            if (!genderRatio.Male) genderRatio.Male = 0;
            if (!genderRatio.Female) genderRatio.Female = 0;
            const totalExpected = feeStats?.[0]?.total || 0;
            const collected = feeStats?.[0]?.collected || 0;
            const collectionRate = totalExpected > 0 ? Math.round((collected / totalExpected) * 100) : 0;

            const [planLimits, usage] = await Promise.all([
                getPlanLimitsForSchool(schoolId!),
                getUsageForSchool(schoolId!),
            ]);
            const studentPct = planLimits.maxStudents > 0 ? (usage.totalStudents / planLimits.maxStudents) * 100 : 0;
            const teacherPct = planLimits.maxTeachers > 0 ? (usage.totalTeachers / planLimits.maxTeachers) * 100 : 0;
            const studentLimitWarning = usage.totalStudents >= planLimits.maxStudents ? 'exceeded' : studentPct >= 90 ? 'warning' : 'none';
            const teacherLimitWarning = usage.totalTeachers >= planLimits.maxTeachers ? 'exceeded' : teacherPct >= 90 ? 'warning' : 'none';

            const formattedTrends = last6Months.map(month => ({
                name: month,
                total: monthlyTrends.find(t => t._id === month)?.total || 0
            }));

            sendResponse(res, {
                totalStudents,
                activeStaff,
                planLimits: {
                    maxStudents: planLimits.maxStudents,
                    maxTeachers: planLimits.maxTeachers,
                    planName: planLimits.planName,
                    enabledFeatures: planLimits.enabledFeatures ?? [],
                },
                usage: { totalStudents: usage.totalStudents, totalTeachers: usage.totalTeachers },
                studentLimitWarning,
                teacherLimitWarning,
                monthlyCollection: monthlyCollection[0]?.total || 0,
                pendingFees: pendingFees[0]?.total || 0,
                pendingFeesCount: pendingFees[0]?.count || 0,
                monthlyTrends: formattedTrends,
                totalClasses: totalClasses || 0,
                totalSections,
                avgClassSize: totalClasses ? Math.round(totalStudents / totalClasses) : 0,
                genderRatio,
                collectionRate,
                recentActivities: []
            }, 'Dashboard statistics retrieved', 200);
        } catch (error) {
            next(error);
        }
    }

    /** GET /schools/plans – list active plans for upgrade page */
    async getPlans(_req: Request, res: Response, next: NextFunction) {
        try {
            const plans = await Plan.find({ isActive: true }).sort({ priceMonthly: 1 }).lean();
            sendResponse(res, plans, 'OK', 200);
        } catch (error) {
            next(error);
        }
    }

    /**
     * Master Admin: delete school with full cascade
     * DELETE /schools/:schoolId
     */
    async deleteSchoolByMaster(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            await CascadeDeleteService.deleteSchoolCascade(req.params.schoolId);
            sendResponse(res, null, 'School and related data deleted successfully', 200);
        } catch (error) {
            next(error);
        }
    }
}

export default new SchoolController();
