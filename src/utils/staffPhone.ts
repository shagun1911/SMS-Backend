import ErrorResponse from './errorResponse';

/**
 * Staff login username = normalized national/significant digits (no spaces or symbols).
 * Length bounds align with E.164 subscriber numbers (typical mobile 10–15 digits).
 */
export const STAFF_PHONE_DIGITS_MIN = 10;
export const STAFF_PHONE_DIGITS_MAX = 15;

/** Strip non-digits; common India input +91XXXXXXXXXX → last 10 digits. */
export function normalizeStaffPhone(raw: string): string {
    let d = String(raw || '')
        .normalize('NFKC')
        .replace(/\D/g, '');
    if (d.length >= 12 && d.startsWith('91')) {
        d = d.slice(-10);
    }
    // National trunk 0 (e.g. India 0XXXXXXXXXX stored as 10-digit mobile)
    if (d.length === 11 && d.startsWith('0')) {
        d = d.slice(1);
    }
    while (d.length > STAFF_PHONE_DIGITS_MAX) {
        d = d.slice(-STAFF_PHONE_DIGITS_MAX);
    }
    return d;
}

export function isValidStaffPhoneDigits(digits: string): boolean {
    if (!digits || !/^\d+$/.test(digits)) return false;
    return (
        digits.length >= STAFF_PHONE_DIGITS_MIN && digits.length <= STAFF_PHONE_DIGITS_MAX
    );
}

/** Throws ErrorResponse 400 when invalid (for controllers/services). */
export function parseAndValidateStaffPhone(raw: string): string {
    const digits = normalizeStaffPhone(raw);
    if (!isValidStaffPhoneDigits(digits)) {
        throw new ErrorResponse(
            `Phone must contain ${STAFF_PHONE_DIGITS_MIN}–${STAFF_PHONE_DIGITS_MAX} digits after normalization (spaces and +91 etc. are ignored)`,
            400
        );
    }
    return digits;
}

export function isMongoDuplicateUsernameError(err: unknown): boolean {
    const e = err as { code?: number; message?: string };
    return e?.code === 11000 && String(e?.message || '').toLowerCase().includes('username');
}
