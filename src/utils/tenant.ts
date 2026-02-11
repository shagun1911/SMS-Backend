import { FilterQuery } from 'mongoose';

/**
 * Builds a Mongoose filter object based on the tenant context (schoolId).
 * If schoolId is provided, it isolates the query to that school.
 * If schoolId is undefined (Super Admin global view), it returns an empty filter or the existing one.
 * 
 * @param schoolId - The ID of the school to filter by (from req.schoolId)
 * @param existingFilter - Any existing filter to merge with
 * @returns A Mongoose filter query object
 */
export const getTenantFilter = <T>(
    schoolId: string | undefined,
    existingFilter: FilterQuery<T> = {}
): FilterQuery<T> => {
    const filter = { ...existingFilter } as any;

    if (schoolId) {
        filter.schoolId = schoolId;
    }

    return filter;
};

/**
 * Ensures that for non-super admins, the schoolId is always present in the payload.
 * Useful for creation and update operations.
 * 
 * @param schoolId - The current tenant ID
 * @param data - The data object to be saved
 */
export const injectTenantId = <T>(schoolId: string | undefined, data: T): T => {
    if (!schoolId) return data;
    return { ...data, schoolId };
};
