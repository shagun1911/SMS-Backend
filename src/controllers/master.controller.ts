import { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import axios from 'axios';
import School from '../models/school.model';
import Plan, { PLAN_FEATURE_KEYS } from '../models/plan.model';
import SchoolSubscription from '../models/schoolSubscription.model';
import SystemAnnouncement from '../models/systemAnnouncement.model';
import SupportTicket from '../models/supportTicket.model';
import Usage from '../models/usage.model';
import ErrorResponse from '../utils/errorResponse';
import { sendResponse } from '../utils/response';
import config from '../config';

export class MasterController {
    /** GET /master/dashboard – clean SaaS dashboard */
    async getDashboard(_req: Request, res: Response, next: NextFunction) {
        try {
            const now = new Date();
            const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
            const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

            const [
                totalSchools,
                activeSubs,
                expiredOrSuspendedCount,
                plansWithCount,
                newThisMonth,
                expiringSubs,
                allSubsForMrr,
            ] = await Promise.all([
                School.countDocuments({ isActive: true }),
                SchoolSubscription.countDocuments({ status: 'active', subscriptionEnd: { $gte: now } }),
                SchoolSubscription.countDocuments({ $or: [{ status: 'expired' }, { status: 'suspended' }, { subscriptionEnd: { $lt: now } }] }),
                SchoolSubscription.aggregate([
                    { $match: { status: 'active', subscriptionEnd: { $gte: now } } },
                    { $group: { _id: '$planId', count: { $sum: 1 } } },
                    { $lookup: { from: 'plans', localField: '_id', foreignField: '_id', as: 'plan' } },
                    { $unwind: '$plan' },
                ]),
                School.countDocuments({ isActive: true, createdAt: { $gte: startOfThisMonth } }),
                SchoolSubscription.find({
                    status: 'active',
                    subscriptionEnd: { $gte: now, $lte: in30Days },
                })
                    .populate('planId', 'name')
                    .populate('schoolId', 'schoolName schoolCode')
                    .lean(),
                SchoolSubscription.find({})
                    .populate('planId', 'priceMonthly')
                    .lean(),
            ]);

            let revenue = 0;
            for (const row of plansWithCount) {
                revenue += (row.plan?.priceMonthly ?? 0) * (row.count ?? 0);
            }

            const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            const mrrTrend: { name: string; value: number }[] = [];
            for (let i = 11; i >= 0; i--) {
                const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
                const monthStart = new Date(d.getFullYear(), d.getMonth(), 1);
                const monthEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
                let monthRevenue = 0;
                for (const sub of allSubsForMrr as any[]) {
                    const start = sub.subscriptionStart ? new Date(sub.subscriptionStart) : null;
                    const end = sub.subscriptionEnd ? new Date(sub.subscriptionEnd) : null;
                    if (!start || !end) continue;
                    if (start <= monthEnd && end >= monthStart) {
                        monthRevenue += sub.planId?.priceMonthly ?? 0;
                    }
                }
                mrrTrend.push({
                    name: `${monthNames[monthStart.getMonth()]} ${monthStart.getFullYear()}`,
                    value: monthRevenue,
                });
            }

            const expiringSchools = (expiringSubs as any[]).map((s) => ({
                _id: s.schoolId?._id ?? s.schoolId,
                schoolName: s.schoolId?.schoolName ?? '—',
                schoolCode: s.schoolId?.schoolCode ?? '—',
                planName: s.planId?.name ?? '—',
                subscriptionEnd: s.subscriptionEnd,
            }));

            return sendResponse(
                res,
                {
                    totalSchools,
                    activeSchools: activeSubs,
                    expiredSchools: expiredOrSuspendedCount,
                    revenue,
                    newThisMonth,
                    expiringSchools,
                    mrrTrend,
                },
                'OK',
                200
            );
        } catch (error) {
            next(error);
        }
    }

    /** GET /master/schools – only real registered schools (isActive), with health score (aggregate usage for score only) */
    async getSchools(req: Request, res: Response, next: NextFunction) {
        try {
            const now = new Date();
            const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
            const page = parseInt(req.query.page as string) || 1;
            const limit = Math.min(parseInt(req.query.limit as string) || 10, 100);
            const skip = (page - 1) * limit;
            const filter = { isActive: true };

            const [schools, total] = await Promise.all([
                School.find(filter).skip(skip).limit(limit).sort({ createdAt: -1 }).lean(),
                School.countDocuments(filter),
            ]);

            const schoolIds = (schools as any[]).map((s) => s._id);
            const [subscriptions, usages] = await Promise.all([
                SchoolSubscription.find({ schoolId: { $in: schoolIds } })
                    .populate('planId', 'name maxStudents maxTeachers priceMonthly')
                    .lean(),
                Usage.find({ schoolId: { $in: schoolIds } }).lean(),
            ]);

            const subBySchool = new Map((subscriptions as any[]).map((s) => [s.schoolId.toString(), s]));
            const usageBySchool = new Map((usages as any[]).map((u) => [u.schoolId.toString(), u]));

            const rows = (schools as any[]).map((s) => {
                const sub = subBySchool.get(s._id.toString()) as any;
                const usage = usageBySchool.get(s._id.toString()) as any;
                const planName = sub?.planId?.name ?? '—';
                const status = sub ? (sub.subscriptionEnd < now ? 'expired' : sub.status) : 'none';
                const end = sub?.subscriptionEnd ? new Date(sub.subscriptionEnd) : null;
                const activeSub = status === 'active' && end && end >= now;
                const notExpiringSoon = end && end >= in30Days;
                const hasStudents = (usage?.totalStudents ?? 0) > 0;
                const hasTeachers = (usage?.totalTeachers ?? 0) > 0;
                let score = 0;
                if (activeSub) score += 40;
                if (notExpiringSoon) score += 20;
                if (hasStudents) score += 20;
                if (hasTeachers) score += 20;
                const healthLabel = score >= 80 ? 'Good' : score >= 40 ? 'Fair' : 'At Risk';
                return {
                    _id: s._id,
                    schoolName: s.schoolName,
                    schoolCode: s.schoolCode,
                    plan: planName,
                    status,
                    subscriptionEnd: sub?.subscriptionEnd,
                    isActive: s.isActive,
                    healthScore: score,
                    healthLabel,
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

    /** POST /master/schools/bulk-action – activate, suspend, or export (export is client-side) */
    async bulkAction(req: Request, res: Response, next: NextFunction) {
        try {
            const { action, schoolIds } = req.body;
            if (!Array.isArray(schoolIds) || schoolIds.length === 0) {
                return next(new ErrorResponse('schoolIds array required', 400));
            }
            if (action !== 'activate' && action !== 'suspend') {
                return next(new ErrorResponse('action must be activate or suspend', 400));
            }
            const now = new Date();
            const subs = await SchoolSubscription.find({ schoolId: { $in: schoolIds } });
            for (const sub of subs) {
                sub.status = action === 'activate' ? 'active' : 'suspended';
                if (action === 'activate' && sub.subscriptionEnd < now) {
                    sub.subscriptionEnd = new Date(now.getFullYear() + 1, now.getMonth(), now.getDate());
                }
                await sub.save();
            }
            return sendResponse(res, { updated: subs.length }, 'OK', 200);
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
            if (req.body.isDefault === true) {
                await Plan.updateMany({}, { isDefault: false });
            }
            const priceMonthly = Number(req.body.priceMonthly) || 0;
            const priceYearly = priceMonthly === 0 ? 0 : priceMonthly * 11;
            const enabledFeatures = Array.isArray(req.body.enabledFeatures) ? req.body.enabledFeatures : [...PLAN_FEATURE_KEYS];
            const plan = await Plan.create({
                ...req.body,
                priceYearly,
                enabledFeatures,
            });
            return sendResponse(res, plan, 'Plan created', 201);
        } catch (error) {
            next(error);
        }
    }

    /** PUT /master/plans/:id */
    async updatePlan(req: Request, res: Response, next: NextFunction) {
        try {
            if (req.body.isDefault === true) {
                await Plan.updateMany({ _id: { $ne: req.params.id } }, { isDefault: false });
            }
            const priceMonthly = Number(req.body.priceMonthly);
            if (typeof priceMonthly === 'number' && !Number.isNaN(priceMonthly)) {
                req.body.priceYearly = priceMonthly === 0 ? 0 : priceMonthly * 11;
            }
            if (Array.isArray(req.body.enabledFeatures)) {
                // keep as sent
            } else {
                delete req.body.enabledFeatures;
            }
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

            const now = new Date();
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

    /** GET /master/usage-reports – Platform Activity (no student/teacher data) */
    async getUsageReports(_req: Request, res: Response, next: NextFunction) {
        try {
            const now = new Date();
            const schools = await School.find({ isActive: true }).lean();
            const schoolIds = (schools as any[]).map((s) => s._id);
            const subscriptions = await SchoolSubscription.find({ schoolId: { $in: schoolIds } })
                .populate('planId', 'name')
                .lean();
            const subBySchool = new Map((subscriptions as any[]).map((s) => [s.schoolId.toString(), s]));

            const reports = (schools as any[]).map((s) => {
                const sub = subBySchool.get(s._id.toString()) as any;
                const plan = sub?.planId;
                const planName = plan?.name ?? '—';
                const status = sub ? (sub.subscriptionEnd < now ? 'expired' : sub.status) : 'none';
                const end = sub?.subscriptionEnd ? new Date(sub.subscriptionEnd) : null;
                const daysUntilExpiry = end && end >= now ? Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)) : null;
                const lastChange = sub?.updatedAt ?? sub?.subscriptionStart ?? null;
                return {
                    schoolId: s._id,
                    schoolName: s.schoolName,
                    schoolCode: s.schoolCode,
                    planName,
                    subscriptionStatus: status,
                    daysUntilExpiry,
                    lastSubscriptionChange: lastChange,
                };
            });

            return sendResponse(res, { reports }, 'OK', 200);
        } catch (error) {
            next(error);
        }
    }

    /** GET /master/billing-overview – revenue and plan distribution */
    async getBillingOverview(_req: Request, res: Response, next: NextFunction) {
        try {
            const now = new Date();
            const activeSubs = await SchoolSubscription.find({
                status: 'active',
                subscriptionEnd: { $gte: now },
            })
                .populate('planId', 'name priceMonthly priceYearly')
                .lean();

            const planCounts = new Map<string, { count: number; priceMonthly: number; priceYearly: number; name: string }>();
            let monthlyRevenue = 0;
            for (const sub of activeSubs as any[]) {
                const plan = sub.planId;
                if (!plan) continue;
                monthlyRevenue += plan.priceMonthly ?? 0;
                const id = plan._id.toString();
                if (!planCounts.has(id)) {
                    planCounts.set(id, {
                        name: plan.name,
                        count: 0,
                        priceMonthly: plan.priceMonthly ?? 0,
                        priceYearly: plan.priceYearly ?? 0,
                    });
                }
                planCounts.get(id)!.count += 1;
            }
            const distribution: { planId: string; name: string; priceMonthly: number; priceYearly: number; count: number; revenueMonthly: number; revenueYearly: number }[] = [];
            planCounts.forEach((v, planId) => {
                const revMo = v.priceMonthly * v.count;
                const revYr = v.priceYearly * v.count;
                distribution.push({
                    planId,
                    name: v.name,
                    priceMonthly: v.priceMonthly,
                    priceYearly: v.priceYearly,
                    count: v.count,
                    revenueMonthly: revMo,
                    revenueYearly: revYr,
                });
            });

            const totalSchools = await School.countDocuments({ isActive: true });
            const paidCount = activeSubs.length;
            const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
            const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
            const churnThisMonth = await SchoolSubscription.countDocuments({
                subscriptionEnd: { $gte: startOfMonth, $lte: endOfMonth },
            });
            const arpu = paidCount > 0 ? monthlyRevenue / paidCount : 0;
            const projectedArr = monthlyRevenue * 12;

            return sendResponse(
                res,
                {
                    monthlyRevenue,
                    annualRevenue: monthlyRevenue * 12,
                    totalOrganizations: totalSchools,
                    paidPlans: paidCount,
                    distribution,
                    arpu,
                    churnThisMonth,
                    projectedArr,
                },
                'OK',
                200
            );
        } catch (error) {
            next(error);
        }
    }

    /** GET /master/announcements – list all announcements (master only) */
    async getAnnouncements(_req: Request, res: Response, next: NextFunction) {
        try {
            const list = await SystemAnnouncement.find().sort({ createdAt: -1 }).lean();
            return sendResponse(res, list, 'OK', 200);
        } catch (error) {
            next(error);
        }
    }

    /** POST /master/announcements – create announcement */
    async createAnnouncement(req: Request, res: Response, next: NextFunction) {
        try {
            const { title, message, priority, expiresAt, isActive } = req.body;
            const doc = await SystemAnnouncement.create({
                title: title || 'Announcement',
                message: message || '',
                priority: priority === 'warning' || priority === 'critical' ? priority : 'info',
                expiresAt: expiresAt ? new Date(expiresAt) : undefined,
                isActive: isActive !== false,
            });
            return sendResponse(res, doc, 'Created', 201);
        } catch (error) {
            next(error);
        }
    }

    /** DELETE /master/announcements/:id */
    async deleteAnnouncement(req: Request, res: Response, next: NextFunction) {
        try {
            const doc = await SystemAnnouncement.findByIdAndDelete(req.params.id);
            if (!doc) return next(new ErrorResponse('Announcement not found', 404));
            return sendResponse(res, null, 'Deleted', 200);
        } catch (error) {
            next(error);
        }
    }

    /** GET /announcements/active – active announcements for school dashboard (any authenticated user) */
    async getActiveAnnouncements(_req: Request, res: Response, next: NextFunction) {
        try {
            const now = new Date();
            const list = await SystemAnnouncement.find({
                isActive: true,
                $or: [{ expiresAt: { $exists: false } }, { expiresAt: null }, { expiresAt: { $gt: now } }],
            })
                .sort({ createdAt: -1 })
                .lean();
            return sendResponse(res, list, 'OK', 200);
        } catch (error) {
            next(error);
        }
    }

    /** GET /master/support – list all support tickets */
    async getSupportTickets(_req: Request, res: Response, next: NextFunction) {
        try {
            const list = await SupportTicket.find().sort({ createdAt: -1 }).lean();
            return sendResponse(res, list, 'OK', 200);
        } catch (error) {
            next(error);
        }
    }

    /** GET /master/system-health – full technology stack health analytics */
    async getSystemHealth(_req: Request, res: Response, _next: NextFunction) {
        const results: Record<string, any> = {};

        // ── 1. MongoDB stats ─────────────────────────────────────────────
        try {
            const db = mongoose.connection.db!;
            const dbStats: any = await db.command({ dbStats: 1, scale: 1024 * 1024 }); // MB
            const collections = await db.listCollections().toArray();
            const colStats = await Promise.all(
                collections.map(async (col) => {
                    try {
                        const s: any = await db.command({ collStats: col.name, scale: 1024 });
                        return {
                            name: col.name,
                            count: s.count ?? 0,
                            sizeMB: parseFloat(((s.size ?? 0) / 1024).toFixed(2)),
                            indexSizeMB: parseFloat(((s.totalIndexSize ?? 0) / 1024).toFixed(2)),
                        };
                    } catch {
                        return { name: col.name, count: 0, sizeMB: 0, indexSizeMB: 0 };
                    }
                })
            );
            colStats.sort((a, b) => b.sizeMB - a.sizeMB);

            const FREE_TIER_MB = 512;
            const usedMB = parseFloat((dbStats.dataSize / 1024 || 0).toFixed(2));
            const storageMB = parseFloat(((dbStats.dataSize + dbStats.indexSize) / 1024 || 0).toFixed(2));
            const pct = Math.min(Math.round((storageMB / FREE_TIER_MB) * 100), 100);

            results.mongodb = {
                status: 'ok',
                usedMB,
                storageMB,
                freeTierLimitMB: FREE_TIER_MB,
                percentUsed: pct,
                warningLevel: pct >= 90 ? 'critical' : pct >= 75 ? 'warning' : 'ok',
                collections: colStats,
                totalCollections: colStats.length,
                objects: dbStats.objects ?? 0,
                estimatedDocCount: colStats.reduce((s: number, c: any) => s + c.count, 0),
                projectedFullAtSchools: storageMB > 0
                    ? Math.floor(FREE_TIER_MB / (storageMB / Math.max(1, (await School.countDocuments()))))
                    : null,
            };
        } catch (err: any) {
            results.mongodb = { status: 'error', message: err.message };
        }

        // ── 2. Cloudinary ────────────────────────────────────────────────
        const cloudAccounts = config.cloudinary.accounts;
        results.cloudinary = await Promise.all(
            cloudAccounts.map(async (acc, idx) => {
                try {
                    const res = await axios.get('https://api.cloudinary.com/v1_1/' + acc.cloudName + '/usage', {
                        auth: { username: acc.apiKey, password: acc.apiSecret },
                        timeout: 8000,
                    });
                    const d = res.data;
                    const usedGB = parseFloat(((d.storage?.usage ?? 0) / 1073741824).toFixed(3));
                    const limitGB = parseFloat(((d.storage?.limit ?? 25 * 1073741824) / 1073741824).toFixed(1));
                    const pct = Math.round((usedGB / limitGB) * 100);
                    return {
                        account: idx + 1,
                        cloudName: acc.cloudName,
                        status: 'ok',
                        storageUsedGB: usedGB,
                        storageLimitGB: limitGB,
                        percentUsed: pct,
                        warningLevel: pct >= 90 ? 'critical' : pct >= 75 ? 'warning' : 'ok',
                        bandwidthUsedGB: parseFloat(((d.bandwidth?.usage ?? 0) / 1073741824).toFixed(3)),
                        bandwidthLimitGB: parseFloat(((d.bandwidth?.limit ?? 0) / 1073741824).toFixed(1)),
                        transformations: d.transformations?.usage ?? 0,
                        requests: d.requests ?? 0,
                        resources: d.resources ?? 0,
                        derivedResources: d.derived_resources ?? 0,
                        plan: d.plan ?? 'Free',
                        lastUpdated: new Date().toISOString(),
                    };
                } catch (err: any) {
                    return {
                        account: idx + 1,
                        cloudName: acc.cloudName,
                        status: 'error',
                        message: err.response?.data?.error?.message ?? err.message,
                    };
                }
            })
        );

        // ── 3. Groq ──────────────────────────────────────────────────────
        try {
            const groqRes = await axios.get('https://api.groq.com/openai/v1/models', {
                headers: { Authorization: `Bearer ${config.groq.apiKey}` },
                timeout: 6000,
            });
            const models = (groqRes.data?.data ?? []).map((m: any) => m.id);
            results.groq = {
                status: 'ok',
                activeModel: config.groq.model,
                modelAvailable: models.includes(config.groq.model),
                availableModels: models.filter((m: string) => m.includes('llama') || m.includes('mixtral') || m.includes('gemma')),
                note: 'Groq free tier: 14,400 req/day, 500,000 tokens/day (resets daily at midnight UTC)',
                dailyReqLimit: 14400,
                dailyTokenLimit: 500000,
                resetSchedule: 'Daily at 00:00 UTC',
            };
        } catch (err: any) {
            results.groq = {
                status: err.response?.status === 401 ? 'invalid_key' : 'error',
                message: err.response?.data?.error?.message ?? err.message,
            };
        }

        // ── 4. Gemini ────────────────────────────────────────────────────
        try {
            const geminiRes = await axios.get(
                `https://generativelanguage.googleapis.com/v1beta/models?key=${config.gemini.apiKey}`,
                { timeout: 6000 }
            );
            const models = (geminiRes.data?.models ?? []).map((m: any) => m.name.replace('models/', ''));
            results.gemini = {
                status: 'ok',
                activeModel: config.gemini.model,
                modelAvailable: models.some((m: string) => m.includes(config.gemini.model)),
                note: 'Gemini free tier: 15 req/min, 1500 req/day, 1M tokens/min (resets daily)',
                dailyReqLimit: 1500,
                reqPerMinLimit: 15,
                resetSchedule: 'Daily at 00:00 Pacific Time',
            };
        } catch (err: any) {
            results.gemini = {
                status: err.response?.status === 400 || err.response?.status === 403 ? 'invalid_key' : 'error',
                message: err.response?.data?.error?.message ?? err.message,
            };
        }

        // ── 5. Overall summary ───────────────────────────────────────────
        const allOk = [
            results.mongodb?.status,
            results.groq?.status,
            results.gemini?.status,
            ...(results.cloudinary ?? []).map((c: any) => c.status),
        ].every((s) => s === 'ok');

        results.summary = {
            overallStatus: allOk ? 'healthy' : 'degraded',
            checkedAt: new Date().toISOString(),
        };

        return sendResponse(res, results, 'System health', 200);
    }

    /** PATCH /master/support/:id – update status, resolution */
    async updateSupportTicket(req: Request, res: Response, next: NextFunction) {
        try {
            const { status, resolution } = req.body;
            const ticket = await SupportTicket.findById(req.params.id);
            if (!ticket) return next(new ErrorResponse('Ticket not found', 404));
            if (status === 'open' || status === 'in_progress' || status === 'resolved') {
                ticket.status = status;
            }
            if (typeof resolution === 'string') {
                ticket.resolution = resolution;
            }
            if (status === 'resolved') {
                ticket.resolvedAt = ticket.resolvedAt ?? new Date();
                ticket.resolvedBy = (req as any).user?._id;
            }
            await ticket.save();
            return sendResponse(res, ticket, 'Updated', 200);
        } catch (error) {
            next(error);
        }
    }
}

export default new MasterController();
