import {
    countChargeableSessionMonths,
    getSessionYearMonths,
    normalizeFeeExemptMonths,
    recurringAnnualMultiplier,
} from './feeExemptMonths';

type FeeItem = { amount: number; type?: string };

function splitStructureFeeItems(structure: any): { monthlyTotal: number; oneTimeTotal: number } {
    const rawItems: FeeItem[] =
        structure?.components && structure.components.length > 0
            ? structure.components
            : (structure?.fees || []).map((f: any) => ({
                  amount: f.amount,
                  type: f.type,
              }));

    let monthlyTotal = 0;
    let oneTimeTotal = 0;

    for (const item of rawItems) {
        if (!item || typeof item.amount !== 'number') continue;
        const t = (item.type || '').toString().toLowerCase();
        if (t === 'one-time' || t === 'one_time' || t === 'one time') oneTimeTotal += item.amount;
        else if (t === 'monthly') monthlyTotal += item.amount;
    }

    return { monthlyTotal, oneTimeTotal };
}

export function totalAnnualConcessionOnMonthly(student: any, annualRecurringTotal: number): number {
    if (!annualRecurringTotal || annualRecurringTotal <= 0) return 0;
    const flat = Math.max(0, Math.round(Number(student?.concessionAmount) || 0));
    const pct = Math.min(100, Math.max(0, Number(student?.concessionPercent) || 0));
    const fromPct = pct > 0 ? Math.round((annualRecurringTotal * pct) / 100) : 0;
    return Math.min(annualRecurringTotal, flat + fromPct);
}

export function computeReceiptAlignedStudentTotals(input: {
    student: any;
    structure: any;
    session: any;
    transportMonthlyFee?: number;
    paidAmount?: number;
}) {
    const { student, structure, session } = input;
    const transportMonthlyFee = Number(input.transportMonthlyFee) || 0;
    const paidAmount = Number(input.paidAmount) || 0;

    const { monthlyTotal: baseMonthlyTotal, oneTimeTotal } = splitStructureFeeItems(structure);
    const monthlyTotal = baseMonthlyTotal + transportMonthlyFee;

    const sessionMonths = getSessionYearMonths(session);
    const exemptCanon = normalizeFeeExemptMonths(
        structure?.feeExemptMonths,
        sessionMonths.map((m) => m.monthName)
    );
    const sessionMonthCount = Math.max(1, sessionMonths.length);
    const transportChargeableCount = Math.max(0, countChargeableSessionMonths(sessionMonths, exemptCanon));
    const multiplier = recurringAnnualMultiplier(structure as any, sessionMonths.length, exemptCanon);

    // Concession rule: apply ONLY on regular monthly fees, never on bus/transport monthly fee.
    // Exempt months waive transport only; regular monthly components remain chargeable.
    const annualRecurringForConcession = baseMonthlyTotal * sessionMonthCount;
    const annualTransport = transportMonthlyFee * transportChargeableCount;
    const annualRecurring = annualRecurringForConcession + annualTransport;
    const grossAnnual = annualRecurringForConcession + annualTransport + oneTimeTotal;
    const concessionAnnual = totalAnnualConcessionOnMonthly(student, annualRecurringForConcession);
    const netAnnual = Math.max(0, grossAnnual - concessionAnnual);
    const dueAmount = Math.max(0, netAnnual - paidAmount);
    const effectiveMonthlyFee =
        sessionMonthCount > 0 ? (annualRecurring - concessionAnnual) / sessionMonthCount : 0;

    return {
        monthlyTotal,
        oneTimeTotal,
        chargeableCount: transportChargeableCount,
        multiplier,
        annualRecurring,
        grossAnnual,
        concessionAnnual,
        netAnnual,
        paidAmount,
        dueAmount,
        effectiveMonthlyFee,
        feeExemptMonths: Array.from(exemptCanon),
    };
}
