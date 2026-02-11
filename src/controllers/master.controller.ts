import { Request, Response, NextFunction } from 'express';
import School from '../models/school.model';
import User from '../models/user.model';
import Student from '../models/student.model';
import StudentFee from '../models/studentFee.model';
import AuditLog from '../models/auditLog.model';
import ErrorResponse from '../utils/errorResponse';

class MasterController {
    /**
     * Get Global Stats for Master Admin
     */
    async getGlobalStats(_req: Request, res: Response, next: NextFunction) {
        try {
            const [totalSchools, totalStudents, totalUsers, registrationTrends, revenueData] = await Promise.all([
                School.countDocuments(),
                Student.countDocuments(),
                User.countDocuments(),
                School.aggregate([
                    {
                        $group: {
                            _id: { $month: "$createdAt" },
                            count: { $sum: 1 }
                        }
                    },
                    { $sort: { "_id": 1 } }
                ]),
                StudentFee.aggregate([
                    { $match: { status: 'paid' } },
                    { $group: { _id: null, total: { $sum: '$paidAmount' } } }
                ])
            ]);

            const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
            const monthlyTrends = registrationTrends.map(t => ({
                name: monthNames[t._id - 1],
                total: t.count
            }));

            const revenue = revenueData[0]?.total || 0;

            res.status(200).json({
                success: true,
                data: {
                    totalSchools,
                    totalStudents,
                    totalUsers,
                    revenue,
                    activeSessions: Math.floor(Math.random() * 20), // Still somewhat mock, but depends on real data soon
                    monthlyTrends
                }
            });
        } catch (error) {
            next(error);
        }
    }

    /**
     * Get all schools with pagination
     */
    async getSchools(req: Request, res: Response, next: NextFunction) {
        try {
            const page = parseInt(req.query.page as string) || 1;
            const limit = parseInt(req.query.limit as string) || 10;
            const skip = (page - 1) * limit;

            const schools = await School.find()
                .skip(skip)
                .limit(limit)
                .sort({ createdAt: -1 });

            const total = await School.countDocuments();

            res.status(200).json({
                success: true,
                count: schools.length,
                pagination: {
                    total,
                    page,
                    pages: Math.ceil(total / limit)
                },
                data: schools
            });
        } catch (error) {
            next(error);
        }
    }

    /**
     * Update school status or plan
     */
    async updateSchool(req: Request, res: Response, next: NextFunction) {
        try {
            const school = await School.findByIdAndUpdate(req.params.id, req.body, {
                new: true,
                runValidators: true
            });

            if (!school) {
                return next(new ErrorResponse(`School not found with id of ${req.params.id}`, 404));
            }

            res.status(200).json({
                success: true,
                data: school
            });
        } catch (error) {
            next(error);
        }
    }

    /**
     * Get Global Activity/Events
     */
    async getGlobalActivity(_req: Request, res: Response, next: NextFunction) {
        try {
            const activities = await AuditLog.find()
                .limit(10)
                .sort({ createdAt: -1 })
                .populate('userId', 'name')
                .populate('schoolId', 'schoolName');

            const formattedActivities = activities.map(log => ({
                id: log._id,
                event: log.action,
                description: `${(log.userId as any)?.name} performed ${log.action} on ${log.module}: ${log.description}`,
                time: log.createdAt,
                type: log.module.toLowerCase()
            }));

            res.status(200).json({
                success: true,
                data: formattedActivities
            });
        } catch (error) {
            next(error);
        }
    }
}

export default new MasterController();
