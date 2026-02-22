import SchoolSubscription from '../models/schoolSubscription.model';
import Usage from '../models/usage.model';
import ErrorResponse from '../utils/errorResponse';
import { PLAN_FEATURE_KEYS } from '../models/plan.model';

export interface PlanLimits {
    maxStudents: number;
    maxTeachers: number;
    planName: string;
    /** Features enabled for this plan. If plan has none set, all features are allowed (backward compat). */
    enabledFeatures: string[];
}

const DEFAULT_LIMITS: PlanLimits = {
    maxStudents: 10000,
    maxTeachers: 1000,
    planName: 'Default',
    enabledFeatures: [...PLAN_FEATURE_KEYS],
};

/**
 * Get plan limits for a school (from active subscription). Returns defaults if no subscription.
 */
export async function getPlanLimitsForSchool(schoolId: string): Promise<PlanLimits> {
    const sub = await SchoolSubscription.findOne({ schoolId })
        .populate<{ planId: { name: string; maxStudents: number; maxTeachers: number; enabledFeatures?: string[] } }>('planId')
        .lean();
    if (!sub?.planId) return DEFAULT_LIMITS;
    const plan = sub.planId as any;
    const enabledFeatures = Array.isArray(plan.enabledFeatures) && plan.enabledFeatures.length > 0
        ? plan.enabledFeatures
        : [...PLAN_FEATURE_KEYS];
    return {
        maxStudents: plan.maxStudents ?? DEFAULT_LIMITS.maxStudents,
        maxTeachers: plan.maxTeachers ?? DEFAULT_LIMITS.maxTeachers,
        planName: plan.name ?? 'Plan',
        enabledFeatures,
    };
}

/**
 * Get current usage for a school.
 */
export async function getUsageForSchool(schoolId: string): Promise<{ totalStudents: number; totalTeachers: number }> {
    const usage = await Usage.findOne({ schoolId }).lean();
    return {
        totalStudents: usage?.totalStudents ?? 0,
        totalTeachers: usage?.totalTeachers ?? 0,
    };
}

/**
 * Throws if school cannot add another student (at or over limit).
 */
export async function checkStudentLimit(schoolId: string): Promise<void> {
    const limits = await getPlanLimitsForSchool(schoolId);
    const usage = await getUsageForSchool(schoolId);
    if (usage.totalStudents >= limits.maxStudents) {
        throw new ErrorResponse(
            `Student limit exceeded (${usage.totalStudents}/${limits.maxStudents}). Upgrade your plan to add more students.`,
            403
        );
    }
}

/**
 * Throws if school cannot add another teacher (at or over limit).
 */
export async function checkTeacherLimit(schoolId: string): Promise<void> {
    const limits = await getPlanLimitsForSchool(schoolId);
    const usage = await getUsageForSchool(schoolId);
    if (usage.totalTeachers >= limits.maxTeachers) {
        throw new ErrorResponse(
            `Teacher limit exceeded (${usage.totalTeachers}/${limits.maxTeachers}). Upgrade your plan to add more teachers.`,
            403
        );
    }
}

export default {
    getPlanLimitsForSchool,
    getUsageForSchool,
    checkStudentLimit,
    checkTeacherLimit,
};
