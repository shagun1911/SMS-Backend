import { Request, Response, NextFunction } from 'express';
import SchoolService from '../services/school.service';
import { sendResponse } from '../utils/response';
import { AuthRequest, UserRole } from '../types';
import Student from '../models/student.model';
import User from '../models/user.model';
import StudentFee from '../models/studentFee.model';
import AuditLog from '../models/auditLog.model';
import Class from '../models/class.model';
import { getPlanLimitsForSchool, getUsageForSchool } from '../services/planLimit.service';

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
                recentActivities,
                totalClasses,
                classList,
                genderAgg,
                feeStats
            ] = await Promise.all([
                Student.countDocuments({ schoolId, isActive: true }),
                User.countDocuments({ schoolId, isActive: true, role: { $ne: UserRole.SUPER_ADMIN } }),
                StudentFee.aggregate([
                    { $match: { schoolId, status: 'paid' } },
                    { $group: { _id: null, total: { $sum: '$paidAmount' } } }
                ]),
                StudentFee.aggregate([
                    { $match: { schoolId, status: { $in: ['pending', 'partial'] } } },
                    { $group: { _id: null, total: { $sum: '$remainingAmount' }, count: { $sum: 1 } } }
                ]),
                StudentFee.aggregate([
                    { $match: { schoolId, status: 'paid' } },
                    { $group: { _id: '$month', total: { $sum: '$paidAmount' } } }
                ]),
                AuditLog.find({ schoolId })
                    .limit(5)
                    .sort({ createdAt: -1 })
                    .populate('userId', 'name'),
                Class.countDocuments({ schoolId, isActive: true }),
                Class.find({ schoolId, isActive: true }),
                Student.aggregate([
                    { $match: { schoolId, isActive: true } },
                    { $group: { _id: '$gender', count: { $sum: 1 } } }
                ]),
                StudentFee.aggregate([
                    { $match: { schoolId } },
                    {
                        $group: {
                            _id: null,
                            collected: { $sum: '$paidAmount' },
                            total: { $sum: { $add: ['$paidAmount', '$remainingAmount'] } }
                        }
                    }
                ])
            ]);
            const totalSections = classList?.reduce((acc: number, c: any) => acc + (c.sections?.length || 1), 0) || 0;
            const genderRatio = {
                male: genderAgg?.find((g: any) => g._id === 'Male')?.count || 0,
                female: genderAgg?.find((g: any) => g._id === 'Female')?.count || 0
            };
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
                planLimits: { maxStudents: planLimits.maxStudents, maxTeachers: planLimits.maxTeachers, planName: planLimits.planName },
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
                attendanceRate: 0,
                recentActivities: recentActivities.map((log: any) => ({
                    id: log._id,
                    event: log.action,
                    description: `${(log.userId as any)?.name}: ${log.description}`,
                    time: log.createdAt,
                    type: log.module.toLowerCase()
                }))
            }, 'Dashboard statistics retrieved', 200);
        } catch (error) {
            next(error);
        }
    }
}

export default new SchoolController();
