import { getTenantFilter, assertSameTenant } from '../tenant';
import ErrorResponse from '../errorResponse';

describe('tenant', () => {
    it('getTenantFilter adds schoolId when provided', () => {
        expect(getTenantFilter('s1', { a: 1 } as any)).toEqual({ a: 1, schoolId: 's1' });
    });

    it('getTenantFilter leaves filter unchanged when schoolId missing', () => {
        expect(getTenantFilter(undefined, { b: 2 } as any)).toEqual({ b: 2 });
    });

    it('assertSameTenant no-ops when reqSchoolId undefined', () => {
        expect(() => assertSameTenant(undefined, 'other')).not.toThrow();
    });

    it('assertSameTenant throws on mismatch', () => {
        expect(() => assertSameTenant('a', 'b')).toThrow(ErrorResponse);
    });
});
