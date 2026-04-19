const MONTH_NAMES = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
] as const;

export type SessionMonth = { year: number; month: number; monthName: string };

/** Calendar months covered by the session (inclusive of start and end month). */
export function getSessionYearMonths(session: {
    startDate: Date | string;
    endDate: Date | string;
}): SessionMonth[] {
    const start = new Date(session.startDate);
    const end = new Date(session.endDate);
    const result: SessionMonth[] = [];

    let y = start.getFullYear();
    let m = start.getMonth() + 1;
    while (y < end.getFullYear() || (y === end.getFullYear() && m <= end.getMonth() + 1)) {
        result.push({ year: y, month: m, monthName: MONTH_NAMES[m - 1] });
        m++;
        if (m > 12) {
            m = 1;
            y++;
        }
    }
    return result;
}

/**
 * Keep only month names that appear in the active session, with canonical casing
 * from `allowedMonthNames` (session order labels).
 */
export function normalizeFeeExemptMonths(
    input: string[] | undefined | null,
    allowedMonthNames: string[]
): Set<string> {
    const out = new Set<string>();
    if (!input?.length) return out;
    const lowerToCanon = new Map<string, string>();
    for (const a of allowedMonthNames) {
        lowerToCanon.set(a.toLowerCase(), a);
    }
    for (const raw of input) {
        const key = (raw || '').trim().toLowerCase();
        if (!key) continue;
        const canon = lowerToCanon.get(key);
        if (canon) out.add(canon);
    }
    return out;
}

export function countChargeableSessionMonths(
    sessionMonths: SessionMonth[],
    exemptCanon: Set<string>
): number {
    return sessionMonths.filter((x) => !exemptCanon.has(x.monthName)).length;
}

export function isFeeExemptMonth(monthName: string, exemptCanon: Set<string>): boolean {
    return exemptCanon.has(monthName);
}

/** For fee structure totals: multiply recurring by this; default 12 when unset (legacy). */
export function recurringAnnualMultiplier(
    structure: { monthlyMultiplier?: number | null },
    sessionMonthCount: number,
    exemptCanon: Set<string>
): number {
    if (typeof structure.monthlyMultiplier === 'number' && structure.monthlyMultiplier > 0) {
        return structure.monthlyMultiplier;
    }
    if (exemptCanon.size > 0) {
        return Math.max(1, sessionMonthCount - exemptCanon.size);
    }
    return 12;
}
