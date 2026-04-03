import {
    normalizeStaffPhone,
    isValidStaffPhoneDigits,
    parseAndValidateStaffPhone,
} from '../staffPhone';

describe('staffPhone', () => {
    test('normalizeStaffPhone strips formatting and India +91 to 10 digits', () => {
        expect(normalizeStaffPhone('98765 43210')).toBe('9876543210');
        expect(normalizeStaffPhone('+91 98765 43210')).toBe('9876543210');
    });

    test('normalizeStaffPhone strips leading national 0 on 11-digit input', () => {
        expect(normalizeStaffPhone('09876543210')).toBe('9876543210');
    });

    test('normalizeStaffPhone NFKC maps full-width digits', () => {
        // U+FF19 = fullwidth digit nine, etc. — must match stored ASCII digits
        expect(normalizeStaffPhone('\uFF19\uFF18\uFF17\uFF16\uFF15\uFF14\uFF13\uFF12\uFF11\uFF10')).toBe(
            '9876543210'
        );
    });

    test('isValidStaffPhoneDigits', () => {
        expect(isValidStaffPhoneDigits('9876543210')).toBe(true);
        expect(isValidStaffPhoneDigits('123')).toBe(false);
    });

    test('parseAndValidateStaffPhone throws on too short', () => {
        expect(() => parseAndValidateStaffPhone('123')).toThrow();
    });
});
