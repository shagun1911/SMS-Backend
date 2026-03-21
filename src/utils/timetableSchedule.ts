/**
 * Build ordered timetable columns (periods + breaks) from settings.
 * Break with afterPeriod = k is inserted immediately after period k (k >= 1),
 * or before P1 when k === 0.
 */

export type TimetableBreakInput = {
    afterPeriod: number;
    label: string;
    durationMinutes: number;
};

export type TimetableColumn =
    | {
          kind: 'period';
          periodIndex: number;
          label: string;
          startTime: string;
          endTime: string;
      }
    | {
          kind: 'break';
          afterPeriod: number;
          label: string;
          durationMinutes: number;
      };

function parseTimeToMins(s: string): number {
    const [h, m] = (s || '08:00').split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
}

function formatMins(mins: number): string {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Normalize breaks from DB or legacy lunch fields */
export function normalizeTimetableBreaks(settings: {
    breaks?: TimetableBreakInput[] | null;
    lunchAfterPeriod?: number;
    lunchBreakDuration?: number;
    breakLabel?: string;
}): TimetableBreakInput[] {
    const raw = settings.breaks;
    if (Array.isArray(raw)) {
        if (raw.length === 0) return [];
        const mapped = raw.map((b) => ({
            afterPeriod: Math.max(0, Math.min(12, Number(b.afterPeriod) || 0)),
            label: String(b.label || 'Break').trim().slice(0, 40) || 'Break',
            durationMinutes: Math.max(5, Math.min(120, Number(b.durationMinutes) || 15)),
        }));
        return mapped
            .map((b, i) => ({ b, i }))
            .sort((a, b) => a.b.afterPeriod - b.b.afterPeriod || a.i - b.i)
            .map(({ b }) => b);
    }
    const after = Math.max(0, Math.min(12, Number(settings.lunchAfterPeriod) || 0));
    const dur = Math.max(5, Math.min(120, Number(settings.lunchBreakDuration) || 40));
    const label = String(settings.breakLabel || 'Lunch Break').trim() || 'Lunch Break';
    return [{ afterPeriod: after, label, durationMinutes: dur }];
}

export function buildTimetableColumns(
    periodCount: number,
    firstPeriodStart: string,
    periodDurationMinutes: number,
    breaks: TimetableBreakInput[]
): TimetableColumn[] {
    const pc = Math.max(1, Math.min(12, periodCount));
    const pd = Math.max(30, Math.min(60, periodDurationMinutes));

    const byAfter = new Map<number, TimetableBreakInput[]>();
    for (const b of breaks) {
        const ap = Math.max(0, Math.min(pc, b.afterPeriod));
        if (!byAfter.has(ap)) byAfter.set(ap, []);
        byAfter.get(ap)!.push(b);
    }

    const cols: TimetableColumn[] = [];
    let mins = parseTimeToMins(firstPeriodStart);

    const pushBreaksFor = (afterPeriod: number) => {
        const list = byAfter.get(afterPeriod) || [];
        for (const b of list) {
            cols.push({
                kind: 'break',
                afterPeriod,
                label: b.label,
                durationMinutes: b.durationMinutes,
            });
            mins += b.durationMinutes;
        }
    };

    pushBreaksFor(0);

    for (let p = 1; p <= pc; p++) {
        const start = formatMins(mins);
        mins += pd;
        const end = formatMins(mins);
        cols.push({
            kind: 'period',
            periodIndex: p,
            label: `P${p}`,
            startTime: start,
            endTime: end,
        });
        pushBreaksFor(p);
    }

    return cols;
}

export function timetableColumnCount(
    periodCount: number,
    firstPeriodStart: string,
    periodDurationMinutes: number,
    breaks: TimetableBreakInput[]
): number {
    return buildTimetableColumns(periodCount, firstPeriodStart, periodDurationMinutes, breaks).length;
}

/** JSON-safe column descriptors for grid UI */
export type ScheduleColumnDto =
    | { kind: 'period'; label: string; time: string; startTime: string; endTime: string }
    | { kind: 'break'; label: string; shortLabel: string; time: string; durationMinutes: number };

export function buildScheduleColumnDtos(settings: {
    periodCount?: number;
    firstPeriodStart?: string;
    periodDurationMinutes?: number;
    breaks?: TimetableBreakInput[] | null;
    lunchAfterPeriod?: number;
    lunchBreakDuration?: number;
    breakLabel?: string;
} | null): ScheduleColumnDto[] {
    const periodCount = settings?.periodCount ?? 7;
    const first = settings?.firstPeriodStart || '08:00';
    const pd = settings?.periodDurationMinutes ?? 40;
    const breaks = normalizeTimetableBreaks(settings || {});
    return buildTimetableColumns(periodCount, first, pd, breaks).map((c) =>
        c.kind === 'break'
            ? {
                  kind: 'break' as const,
                  label: c.label,
                  shortLabel: c.label.trim().toUpperCase(),
                  time: `${c.durationMinutes} min`,
                  durationMinutes: c.durationMinutes,
              }
            : {
                  kind: 'period' as const,
                  label: c.label,
                  time: `${c.startTime} – ${c.endTime}`,
                  startTime: c.startTime,
                  endTime: c.endTime,
              }
    );
}
