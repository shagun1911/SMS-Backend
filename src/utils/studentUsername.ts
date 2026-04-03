import mongoose from 'mongoose';
import Student from '../models/student.model';

/** Strip whitespace, lowercase, keep only a–z / 0–9 for login-safe usernames. */
export function normalizeFirstNameForUsername(firstName: string): string {
    const raw = (firstName || '').trim().toLowerCase().replace(/\s+/g, '');
    return raw.replace(/[^a-z0-9]/g, '');
}

/**
 * Last 4 digits from phone; if fewer than 4 digit chars, left-pad with zeros.
 * If phone has no digits, use digits from admission number; else "0000".
 */
export function phoneSuffixFour(phone: string | undefined, admissionNumber: string): string {
    const phoneDigits = (phone || '').replace(/\D/g, '');
    if (phoneDigits.length >= 4) {
        return phoneDigits.slice(-4);
    }
    if (phoneDigits.length > 0) {
        return phoneDigits.padStart(4, '0');
    }
    const admDigits = (admissionNumber || '').replace(/\D/g, '');
    if (admDigits.length >= 4) {
        return admDigits.slice(-4);
    }
    if (admDigits.length > 0) {
        return admDigits.padStart(4, '0');
    }
    return '0000';
}

/** `{normalizedFirstName}{last4}` e.g. rahul3210 */
export function buildStudentUsernameBase(
    firstName: string,
    phone: string | undefined,
    admissionNumber: string
): string {
    const namePart = normalizeFirstNameForUsername(firstName);
    const suffix = phoneSuffixFour(phone, admissionNumber);
    const base = `${namePart || 'student'}${suffix}`;
    return base.slice(0, 64);
}

/**
 * Resolves a globally unique username by appending 1, 2, 3… when the base is taken.
 * Concurrent creates: still rely on Mongo unique index + retry in the service on code 11000.
 */
export async function ensureUniqueStudentUsername(
    baseUsername: string,
    excludeStudentId?: mongoose.Types.ObjectId
): Promise<string> {
    const base = (baseUsername || '').toLowerCase().trim().slice(0, 64);
    if (!base) {
        throw new Error('Cannot build student username from empty base');
    }

    let n = 0;
    let candidate = base;
    const maxAttempts = 500;

    while (n < maxAttempts) {
        const filter: Record<string, unknown> = { username: candidate };
        if (excludeStudentId) {
            filter._id = { $ne: excludeStudentId };
        }
        const clash = await Student.findOne(filter).select('_id').lean();
        if (!clash) {
            return candidate;
        }
        n += 1;
        candidate = `${base}${n}`.slice(0, 64);
    }

    throw new Error('Could not allocate a unique student username');
}

export function isMongoDuplicateUsernameError(err: unknown): boolean {
    const e = err as { code?: number; message?: string };
    return e?.code === 11000 && String(e?.message || '').toLowerCase().includes('username');
}
