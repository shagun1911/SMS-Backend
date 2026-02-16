import { Request, Response, NextFunction } from 'express';
import School from '../models/school.model';
import Plan from '../models/plan.model';
import SchoolSubscription from '../models/schoolSubscription.model';
import Usage from '../models/usage.model';
import ErrorResponse from '../utils/errorResponse';
import { sendResponse } from '../utils/response';

const now = new Date();

export class MasterController {
    /** GET /master/dashboard – clean SaaS dashboard */
    async getDashboard(_req: Request, res: Response, next: NextFunction) {
        try {
            const [
                totalSchools,
                activeSubs,
                expiredOrSuspendedCount,
                usageAgg,
                monthlyNewSchools,
                plansWithCount,
            ] = await Promise.all([
                School.countDocuments(),
                SchoolSubscription.countDocuments({ status: 'active', subscriptionEnd: { $gte: now } }),
                SchoolSubscription.countDocuments({ $or: [{ status: 'expired' }, { status: 'suspended' }, { subscriptionEnd: { $lt: now } }] }),
                Usage.aggregate([{ $group: { _id: null, students: { $sum: '$totalStudents' }, teachers: { $sum: '$totalTeachers' } } }]),
                School.aggregate([
                    { $group: { _id: { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } }, count: { $sum: 1 } } },
                    { $sort: { '_id.year': 1, '_id.month': 1 } },
                ]),
                SchoolSubscription.aggregate([
                    { $match: { status: 'active', subscriptionEnd: { $gte: now } } },
                    { $group: { _id: '$planId', count: { $sum: 1 } } },
                    { $lookup: { from: 'plans', localField: '_id', foreignField: '_id', as: 'plan' } },
                    { $unwind: '$plan' },
                ]),
            ]);

            const usage = usageAgg[0] || { students: 0, teachers: 0 };
            let revenue = 0;
            for (const row of plansWithCount) {
                revenue += (row.plan?.priceMonthly ?? 0) * (row.count ?? 0);
            }

            const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            const monthlyNewSchoolsChart = monthlyNewSchools.map((t: any) => ({
                name: `${monthNames[(t._id.month || 1) - 1]} ${t._id.year || ''}`,
                total: t.count,
            }));

            return sendResponse(
                res,
                {
                    totalSchools,
                    activeSchools: activeSubs,
                    expiredSchools: expiredOrSuspendedCount,
                    totalStudents: usage.students,
                    totalTeachers: usage.teachers,
                    revenue,
                    monthlyNewSchools: monthlyNewSchoolsChart,
                },
                'OK',
                200
            );
        } catch (error) {
            next(error);
        }
    }

    /** GET /master/schools – table with Plan, Students, Teachers, Status, no student-level detail */
    async getSchools(req: Request, res: Response, next: NextFunction) {
        try {
            const page = parseInt(req.query.page as string) || 1;
            const limit = Math.min(parseInt(req.query.limit as string) || 10, 100);
            const skip = (page - 1) * limit;

            const [schools, total] = await Promise.all([
                School.find().skip(skip).limit(limit).sort({ createdAt: -1 }).lean(),
                School.countDocuments(),
            ]);

            const schoolIds = (schools as any[]).map((s) => s._id);
            const [subscriptions, usages] = await Promise.all([
                SchoolSubscription.find({ schoolId: { $in: schoolIds } }).populate('planId', 'name maxStudents maxTeachers priceMonthly').lean(),
                Usage.find({ schoolId: { $in: schoolIds } }).lean(),
            ]);

            const subBySchool = new Map((subscriptions as any[]).map((s) => [s.schoolId.toString(), s]));
            const usageBySchool = new Map((usages as any[]).map((u) => [u.schoolId.toString(), u]));

            const rows = (schools as any[]).map((s) => {
                const sub = subBySchool.get(s._id.toString());
                const usage = usageBySchool.get(s._id.toString());
                const planName = sub?.planId?.name ?? '—';
                const status = sub ? (sub.subscriptionEnd < now ? 'expired' : sub.status) : 'none';
                return {
                    _id: s._id,
                    schoolName: s.schoolName,
                    schoolCode: s.schoolCode,
                    plan: planName,
                    students: usage?.totalStudents ?? 0,
                    teachers: usage?.totalTeachers ?? 0,
                    status,
                    subscriptionEnd: sub?.subscriptionEnd,
                    isActive: s.isActive,
                };
            });

            return sendResponse(
                res,
                { rows, pagination: { total, page, pages: Math.ceil(total / limit), limit } },
                'OK',
                200
            );
        } catch (error) {
            next(error);
        }
    }

    /** PATCH /master/schools/:id – update school (e.g. isActive) */
    async updateSchool(req: Request, res: Response, next: NextFunction) {
        try {
            const school = await School.findByIdAndUpdate(req.params.id, req.body, {
                new: true,
                runValidators: true,
            });
            if (!school) return next(new ErrorResponse(`School not found with id of ${req.params.id}`, 404));
            return sendResponse(res, school, 'Updated', 200);
        } catch (error) {
            next(error);
        }
    }

    /** GET /master/plans */
    async getPlans(_req: Request, res: Response, next: NextFunction) {
        try {
            const plans = await Plan.find().sort({ maxStudents: 1 }).lean();
            return sendResponse(res, plans, 'OK', 200);
        } catch (error) {
            next(error);
        }
    }

    /** POST /master/plans */
    async createPlan(req: Request, res: Response, next: NextFunction) {
        try {
            const plan = await Plan.create(req.body);
            return sendResponse(res, plan, 'Plan created', 201);
        } catch (error) {
            next(error);
        }
    }

    /** PUT /master/plans/:id */
    async updatePlan(req: Request, res: Response, next: NextFunction) {
        try {
            const plan = await Plan.findByIdAndUpdate(req.params.id, req.body, {
                new: true,
                runValidators: true,
            });
            if (!plan) return next(new ErrorResponse(`Plan not found with id of ${req.params.id}`, 404));
            return sendResponse(res, plan, 'Updated', 200);
        } catch (error) {
            next(error);
        }
    }

    /** DELETE /master/plans/:id */
    async deletePlan(req: Request, res: Response, next: NextFunction) {
        try {
            const plan = await Plan.findById(req.params.id);
            if (!plan) return next(new ErrorResponse(`Plan not found with id of ${req.params.id}`, 404));
            const inUse = await SchoolSubscription.countDocuments({ planId: plan._id });
            if (inUse > 0) return next(new ErrorResponse('Cannot delete plan that is assigned to schools', 400));
            await Plan.findByIdAndDelete(req.params.id);
            return sendResponse(res, null, 'Plan deleted', 200);
        } catch (error) {
            next(error);
        }
    }

    /** GET /master/subscription/:schoolId */
    async getSubscription(req: Request, res: Response, next: NextFunction) {
        try {
            const sub = await SchoolSubscription.findOne({ schoolId: req.params.schoolId })
                .populate('planId')
                .lean();
            if (!sub) return sendResponse(res, { subscription: null }, 'OK', 200);
            return sendResponse(res, { subscription: sub }, 'OK', 200);
        } catch (error) {
            next(error);
        }
    }

    /** PUT /master/subscription/:schoolId – create or update subscription (change plan, extend, suspend, activate) */
    async putSubscription(req: Request, res: Response, next: NextFunction) {
        try {
            const { planId, subscriptionStart, subscriptionEnd, status } = req.body;
            const schoolId = req.params.schoolId;

            const school = await School.findById(schoolId);
            if (!school) return next(new ErrorResponse('School not found', 404));
            if (planId) {
                const plan = await Plan.findById(planId);
                if (!plan) return next(new ErrorResponse('Plan not found', 404));
            }

            const start = subscriptionStart ? new Date(subscriptionStart) : now;
            const end = subscriptionEnd ? new Date(subscriptionEnd) : new Date(now.getFullYear() + 1, now.getMonth(), now.getDate());
            const newStatus = status === 'suspended' ? 'suspended' : end < now ? 'expired' : 'active';

            let sub = await SchoolSubscription.findOne({ schoolId });
            if (sub) {
                sub.planId = planId || sub.planId;
                sub.subscriptionStart = start;
                sub.subscriptionEnd = end;
                sub.status = newStatus;
                await sub.save();
            } else {
                if (!planId) return next(new ErrorResponse('planId required for new subscription', 400));
                sub = await SchoolSubscription.create({
                    schoolId,
                    planId,
                    subscriptionStart: start,
                    subscriptionEnd: end,
                    status: newStatus,
                });
            }
            const populated = await SchoolSubscription.findById(sub._id).populate('planId').lean();
            return sendResponse(res, populated, 'Subscription updated', 200);
        } catch (error) {
            next(error);
        }
    }
}

export default new MasterController();
