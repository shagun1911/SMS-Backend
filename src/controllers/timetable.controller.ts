import { Response, NextFunction } from 'express';
import { Types } from 'mongoose';
import { AuthRequest } from '../types';
import Timetable from '../models/timetable.model';
import TimetableSettings from '../models/timetableSettings.model';
import TimetableVersion from '../models/timetableVersion.model';
import SchoolTimetableGrid from '../models/schoolTimetableGrid.model';
import Class from '../models/class.model';
import School from '../models/school.model';
import Session from '../models/session.model';
import { sendResponse } from '../utils/response';
import ErrorResponse from '../utils/errorResponse';
import { generateTimetablePDF, generateSchoolTimetablePDF } from '../services/pdfTimetable.service';
import {
    normalizeTimetableBreaks,
    timetableColumnCount,
    buildScheduleColumnDtos,
    buildSlotPlanFromSettings,
    TimetableBreakInput,
} from '../utils/timetableSchedule';

function normTimetableClassName(s: string): string {
    return String(s ?? '')
        .trim()
        .replace(/\s+/g, ' ');
}

/** True only if legacy Timetable rows have real slot content (not empty placeholders). */
function legacyTimetableHasDisplayableSlots(legacy: any[]): boolean {
    if (!Array.isArray(legacy) || legacy.length === 0) return false;
    return legacy.some((t: any) =>
        (t.slots || []).some((s: any) => {
            const subj = s?.subject != null && String(s.subject).trim() !== '';
            const hasTeacher = !!s?.teacherId;
            const tpe = s?.type;
            const isBreakLike = tpe === 'break' || tpe === 'lunch' || tpe === 'assembly';
            return subj || hasTeacher || isBreakLike;
        })
    );
}

/** When legacy Timetable docs are empty or meaningless, build Mon–Sat rows from SchoolTimetableGrid (admin “Save Timetable”). */
function schoolIdForQuery(schoolId: string) {
    return Types.ObjectId.isValid(schoolId) ? new Types.ObjectId(schoolId) : schoolId;
}

async function timetablesFromSchoolGrid(schoolId: string, className: string, section: string) {
    const cn = normTimetableClassName(className);
    const sec = String(section).trim().toUpperCase() || 'A';
    const sid = schoolIdForQuery(schoolId);
    const settings = await TimetableSettings.findOne({ schoolId: sid, isActive: true }).lean();
    const grid = await SchoolTimetableGrid.findOne({ schoolId: sid })
        .populate('rows.cells.teacherId', 'name')
        .lean();
    const rows = (grid as any)?.rows || [];

    const rowMatches = (r: any) => {
        const rn = normTimetableClassName(String(r.className ?? ''));
        const rs = String(r.section || 'A').trim().toUpperCase();
        return rn === cn && rs === sec;
    };

    let row = rows.find(rowMatches);
    if (!row) {
        row = rows.find(
            (r: any) =>
                normTimetableClassName(String(r.className ?? '')).toLowerCase() === cn.toLowerCase() &&
                String(r.section || 'A').trim().toUpperCase() === sec
        );
    }
    if (!row) {
        const cnDigits = cn.replace(/\D/g, '');
        if (cnDigits) {
            row = rows.find((r: any) => {
                const rd = normTimetableClassName(String(r.className ?? '')).replace(/\D/g, '');
                return rd === cnDigits && String(r.section || 'A').trim().toUpperCase() === sec;
            });
        }
    }

    // Do not fall back to "any single row with this class name" — that shows section A's grid for section B.

    if (!row || !Array.isArray(row.cells)) return [];

    const slotPlan = buildSlotPlanFromSettings(settings as any);
    const cells = row.cells as any[];
    const slots: any[] = [];
    for (let i = 0; i < slotPlan.length; i++) {
        const plan = slotPlan[i];
        const cell = cells[i] || {};
        if (plan.kind === 'break') {
            const isLunch = /lunch/i.test(plan.label);
            slots.push({
                startTime: plan.startTime,
                endTime: plan.endTime,
                type: isLunch ? 'lunch' : 'break',
                subject: plan.label,
                title: plan.label,
            });
        } else {
            const tid = cell.teacherId;
            slots.push({
                startTime: plan.startTime,
                endTime: plan.endTime,
                type: 'period',
                subject: cell.subject || '',
                teacherId: tid && typeof tid === 'object' && 'name' in tid ? tid : tid,
            });
        }
    }

    return [1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
        dayOfWeek,
        slots: slots.map((s) => ({ ...s })),
    }));
}

/** Shared by staff GET /timetable and student GET /auth/student/timetable */
async function fetchTimetablesWithSchoolGridFallback(
    schoolId: string | undefined,
    className: string | undefined,
    section: string | undefined
): Promise<any[]> {
    if (!schoolId) return [];
    const filter: any = { schoolId, isActive: true };
    if (className) filter.className = className;
    if (section) filter.section = section;

    let timetables: any[] = await Timetable.find(filter)
        .populate('slots.teacherId', 'name')
        .sort({ dayOfWeek: 1 })
        .lean();

    const useGridFallback =
        Boolean(className && section) &&
        (!timetables || timetables.length === 0 || !legacyTimetableHasDisplayableSlots(timetables));

    if (useGridFallback && className && section) {
        const fromGrid = await timetablesFromSchoolGrid(schoolId, className, section);
        if (fromGrid.length > 0) {
            timetables = fromGrid;
        }
    }
    return timetables;
}

async function getTeacherConflicts(
    _schoolId: string,
    _dayOfWeek: number,
    _slots: { teacherId?: string; startTime: string }[],
    _excludeClassName?: string,
    _excludeSection?: string
): Promise<string[]> {
    // Disabled per user request to allow same teacher in multiple classes for testing.
    return [];
}

class TimetableController {
    async getSettings(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const settings = await TimetableSettings.findOne({
                schoolId: req.schoolId,
                isActive: true,
            }).lean();
            if (!settings) {
                return sendResponse(res, null, 'No settings; use defaults', 200);
            }
            return sendResponse(res, settings, 'Timetable settings retrieved', 200);
        } catch (error) {
            return next(error);
        }
    }

    async upsertSettings(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const {
                periodCount,
                lunchAfterPeriod,
                firstPeriodStart,
                periodDurationMinutes,
                lunchBreakDuration,
                breakLabel,
                breaks: breaksBody,
                subjects,
                sessionId,
                workingDays,
                classSettings,
            } = req.body;
            const filter: any = { schoolId: req.schoolId };
            if (sessionId) filter.sessionId = sessionId;
            let settings = await TimetableSettings.findOne(filter);

            let breaksPayload: TimetableBreakInput[] | undefined;
            if (Array.isArray(breaksBody)) {
                if (breaksBody.length === 0) {
                    breaksPayload = [];
                } else {
                    breaksPayload = breaksBody.map((b: any) => ({
                        afterPeriod: Math.max(0, Math.min(12, Number(b.afterPeriod) || 0)),
                        label: String(b.label || 'Break').trim().slice(0, 40) || 'Break',
                        durationMinutes: Math.max(5, Math.min(120, Number(b.durationMinutes) || 15)),
                    }));
                }
            }

            const pc = periodCount ?? 7;
            const lap = lunchAfterPeriod ?? 4;
            const fps = firstPeriodStart || '08:00';
            const pdm = periodDurationMinutes ?? 40;
            const lbd = lunchBreakDuration ?? 40;
            const bl = (breakLabel || 'Lunch Break').toString().trim();

            const ALL_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
            const validWorkingDays = Array.isArray(workingDays)
                ? workingDays.filter((d: string) => ALL_DAYS.includes(d))
                : undefined;

            const payload: any = {
                schoolId: req.schoolId,
                sessionId: sessionId || undefined,
                periodCount: pc,
                lunchAfterPeriod: lap,
                firstPeriodStart: fps,
                periodDurationMinutes: pdm,
                lunchBreakDuration: lbd,
                breakLabel: bl,
                subjects: Array.isArray(subjects) ? subjects : [],
                isActive: true,
            };

            if (validWorkingDays && validWorkingDays.length > 0) {
                payload.workingDays = validWorkingDays;
            }

            if (Array.isArray(classSettings)) {
                payload.classSettings = classSettings.map((cs: any) => ({
                    className: String(cs.className || '').trim(),
                    section: String(cs.section || 'A').trim().toUpperCase(),
                    periodCount: Math.max(1, Math.min(12, Number(cs.periodCount) || pc)),
                    periodDurationMinutes: Math.max(10, Math.min(120, Number(cs.periodDurationMinutes) || pdm)),
                    firstPeriodStart: String(cs.firstPeriodStart || fps).trim(),
                    breaks: Array.isArray(cs.breaks) ? cs.breaks.map((b: any) => ({
                        afterPeriod: Math.max(0, Math.min(12, Number(b.afterPeriod) || 0)),
                        label: String(b.label || 'Break').trim().slice(0, 40) || 'Break',
                        durationMinutes: Math.max(5, Math.min(120, Number(b.durationMinutes) || 15)),
                    })) : [],
                }));
            }

            if (breaksPayload !== undefined) {
                payload.breaks = breaksPayload;
                const first = breaksPayload[0];
                if (first) {
                    payload.lunchAfterPeriod = first.afterPeriod;
                    payload.lunchBreakDuration = first.durationMinutes;
                    payload.breakLabel = first.label;
                } else {
                    payload.lunchAfterPeriod = 0;
                    payload.lunchBreakDuration = 40;
                    payload.breakLabel = '—';
                }
            }

            if (settings) {
                settings = await TimetableSettings.findByIdAndUpdate(settings._id, payload, { new: true });
            } else {
                settings = await TimetableSettings.create(payload);
            }
            return sendResponse(res, settings, 'Timetable settings saved', 200);
        } catch (error) {
            return next(error);
        }
    }

    /** GET /timetable/day?className=&section=&dayOfWeek= — fetch one class+day timetable */
    async getDayTimetable(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const className = String(req.query.className || '').trim();
            const section = String(req.query.section || 'A').trim().toUpperCase();
            const dayOfWeek = Number(req.query.dayOfWeek);
            if (!className) return next(new ErrorResponse('className is required', 400));
            if (isNaN(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
                return next(new ErrorResponse('dayOfWeek must be 0–6', 400));
            }
            const timetables = await fetchTimetablesWithSchoolGridFallback(req.schoolId, className, section);
            const dayTt = (timetables as any[]).find((t) => t.dayOfWeek === dayOfWeek);
            const settings = await TimetableSettings.findOne({ schoolId: req.schoolId, isActive: true }).lean();
            // Find class-specific settings override
            const classCfg = (settings?.classSettings || []).find(
                (cs: any) =>
                    normTimetableClassName(cs.className) === normTimetableClassName(className) &&
                    String(cs.section || 'A').toUpperCase() === section
            );
            return sendResponse(res, {
                className,
                section,
                dayOfWeek,
                slots: dayTt?.slots || [],
                settings: classCfg || null,
                globalSettings: settings,
            }, 'Day timetable retrieved', 200);
        } catch (error) {
            return next(error);
        }
    }

    /** POST /timetable/day — save one class+day timetable */
    async saveDayTimetable(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const { className, section, dayOfWeek, slots, sessionId } = req.body;
            const sec = String(section || 'A').trim().toUpperCase();
            const day = Number(dayOfWeek);
            if (day < 0 || day > 6 || isNaN(day)) {
                return next(new ErrorResponse('dayOfWeek must be 0–6', 400));
            }
            // Validate against configured working days
            const settings = await TimetableSettings.findOne({ schoolId: req.schoolId, isActive: true }).lean();
            const WORKING_DAYS_MAP: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
            const configuredWorkingDays: string[] = (settings?.workingDays?.length ? settings.workingDays : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
            const allowedNums = configuredWorkingDays.map((d) => WORKING_DAYS_MAP[d]).filter((n) => n !== undefined);
            if (!allowedNums.includes(day)) {
                return next(new ErrorResponse(`Day ${day} is not a configured working day for this school`, 400));
            }
            const conflicts = await getTeacherConflicts(req.schoolId!, day, slots || [], className, sec);
            if (conflicts.length > 0) {
                return res.status(400).json({ success: false, message: 'Teacher conflict', conflicts });
            }
            const existing = await Timetable.findOne({
                schoolId: req.schoolId,
                className,
                section: sec,
                dayOfWeek: day,
            });
            const payload: any = {
                schoolId: req.schoolId,
                className,
                section: sec,
                dayOfWeek: day,
                slots: slots || [],
                isActive: true,
            };
            if (sessionId) payload.sessionId = sessionId;
            let doc;
            if (existing) {
                doc = await Timetable.findByIdAndUpdate(existing._id, payload, { new: true }).populate('slots.teacherId', 'name');
            } else {
                doc = await (await Timetable.create(payload)).populate('slots.teacherId', 'name');
            }
            return sendResponse(res, doc, 'Day timetable saved', 200);
        } catch (error) {
            return next(error);
        }
    }

    async getGrid(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const className = String(req.query.className || '').trim();
            const section = String(req.query.section || '').trim().toUpperCase();

            const settings = await TimetableSettings.findOne({ schoolId: req.schoolId, isActive: true }).lean();
            
            let effectiveSettings: any = settings || {};
            if (className && settings?.classSettings) {
                const override = settings.classSettings.find(
                    (cs: any) =>
                        normTimetableClassName(cs.className) === normTimetableClassName(className) &&
                        String(cs.section || 'A').toUpperCase() === (section || 'A')
                );
                if (override) {
                    effectiveSettings = {
                        ...effectiveSettings,
                        periodCount: override.periodCount,
                        firstPeriodStart: override.firstPeriodStart,
                        periodDurationMinutes: override.periodDurationMinutes,
                        breaks: override.breaks,
                    };
                }
            }

            const periodCount = effectiveSettings.periodCount ?? 7;
            const firstPeriodStart = effectiveSettings.firstPeriodStart || '08:00';
            const periodDurationMinutes = effectiveSettings.periodDurationMinutes ?? 40;
            const normBreaks = normalizeTimetableBreaks(effectiveSettings);
            const totalCols = timetableColumnCount(periodCount, firstPeriodStart, periodDurationMinutes, normBreaks);
            const scheduleColumns = buildScheduleColumnDtos(effectiveSettings);

            // If className/section provided, return per-day grid for that specific class
            if (className) {
                const secNorm = section || 'A';
                const timetables = await fetchTimetablesWithSchoolGridFallback(req.schoolId!, className, secNorm);
                
                const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
                const workingDays: string[] = (settings as any)?.workingDays || ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
                const WORKING_DAYS_MAP: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
                const allowedNums = workingDays.map(d => WORKING_DAYS_MAP[d]);

                const rows = allowedNums.map(dayNum => {
                    const dayTt = timetables.find(t => t.dayOfWeek === dayNum);
                    const slots = dayTt?.slots || [];
                    const cells = scheduleColumns.map(col => {
                        if (col.kind === 'break') return { subject: col.label };
                        const slot = slots.find((s: any) => s.startTime === col.startTime && s.type === 'period');
                        return {
                            subject: slot?.subject || '',
                            teacherId: slot?.teacherId?._id || slot?.teacherId,
                            teacherName: slot?.teacherId?.name,
                        };
                    });
                    return {
                        className: `${className}-${secNorm}`,
                        section: DAY_NAMES[dayNum],
                        cells
                    };
                });

                return sendResponse(res, { settings: effectiveSettings, scheduleColumns, totalCols, rows }, 'Class-specific grid retrieved', 200);
            }

            const grid = await SchoolTimetableGrid.findOne({ schoolId: req.schoolId, isActive: true })
                .populate('rows.cells.teacherId', 'name')
                .lean();
            const classes = await Class.find({ schoolId: req.schoolId, isActive: true }).sort({ className: 1, section: 1 }).lean();
            const rows = (grid as any)?.rows || [];
            
            const rowsWithCells = (classes as any[]).map((cls) => {
                const existing = rows.find((r: any) => r.className === cls.className && (r.section || 'A') === (cls.section || 'A'));
                const cells = existing?.cells?.length ? existing.cells : Array.from({ length: totalCols }, () => ({}));
                while (cells.length < totalCols) cells.push({});
                return {
                    className: cls.className,
                    section: cls.section || 'A',
                    cells: cells.slice(0, totalCols).map((c: any) => {
                        const cell = c || {};
                        return {
                            subject: cell.subject ?? '',
                            teacherId: cell.teacherId?._id || cell.teacherId,
                            teacherName: cell.teacherId?.name,
                        };
                    }),
                };
            });
            return sendResponse(
                res,
                {
                    settings,
                    scheduleColumns,
                    totalCols,
                    rows: rowsWithCells,
                    classNames: (classes as any[]).map((c) => `${c.className}-${c.section || 'A'}`),
                },
                'Timetable grid retrieved',
                200
            );
        } catch (error) {
            return next(error);
        }
    }

    async saveGrid(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const { rows } = req.body;
            if (!Array.isArray(rows)) return next(new ErrorResponse('rows array required', 400));
            const settings = await TimetableSettings.findOne({ schoolId: req.schoolId, isActive: true });
            const periodCount = settings?.periodCount ?? 7;
            const firstPeriodStart = settings?.firstPeriodStart || '08:00';
            const periodDurationMinutes = settings?.periodDurationMinutes ?? 40;
            const normBreaks = normalizeTimetableBreaks(settings?.toObject?.() ?? settings ?? {});
            const totalCols = timetableColumnCount(periodCount, firstPeriodStart, periodDurationMinutes, normBreaks);
            const gridRows = rows.map((r: any) => ({
                className: r.className,
                section: r.section || undefined,
                cells: (r.cells || []).slice(0, totalCols).map((c: any) => ({
                    subject: c.subject || undefined,
                    teacherId: c.teacherId || undefined,
                })),
            }));
            let doc = await SchoolTimetableGrid.findOne({ schoolId: req.schoolId });
            if (doc) {
                doc.rows = gridRows;
                await doc.save();
            } else {
                doc = await SchoolTimetableGrid.create({ schoolId: req.schoolId, rows: gridRows });
            }
            const populated = await SchoolTimetableGrid.findById(doc._id).populate('rows.cells.teacherId', 'name').lean();
            return sendResponse(res, populated, 'Timetable saved', 200);
        } catch (error) {
            return next(error);
        }
    }

    async printGrid(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const className = String(req.query.className || '').trim();
            const section = String(req.query.section || '').trim().toUpperCase();

            const school = await School.findById(req.schoolId);
            if (!school) return next(new ErrorResponse('School not found', 404));
            const session = await Session.findOne({ schoolId: req.schoolId, isActive: true });
            const sessionYear = session ? (session as any).sessionYear?.replace('-', '–') : '2025–26';
            
            const settings = await TimetableSettings.findOne({ schoolId: req.schoolId, isActive: true });
            const settingsObj = settings ? settings.toObject() : null;

            let effectiveSettings: any = settingsObj || {};
            if (className && settingsObj?.classSettings) {
                const override = settingsObj.classSettings.find(
                    (cs: any) =>
                        normTimetableClassName(cs.className) === normTimetableClassName(className) &&
                        String(cs.section || 'A').toUpperCase() === (section || 'A')
                );
                if (override) {
                    effectiveSettings = {
                        ...effectiveSettings,
                        periodCount: override.periodCount,
                        firstPeriodStart: override.firstPeriodStart,
                        periodDurationMinutes: override.periodDurationMinutes,
                        breaks: override.breaks,
                    };
                }
            }

            const periodCount = effectiveSettings.periodCount ?? 7;
            const lunchAfterPeriod = effectiveSettings.lunchAfterPeriod ?? 4;
            const firstPeriodStart = effectiveSettings.firstPeriodStart || '08:00';
            const periodDurationMinutes = effectiveSettings.periodDurationMinutes ?? 40;
            const lunchBreakDuration = effectiveSettings.lunchBreakDuration ?? 40;
            const breakLabel = effectiveSettings.breakLabel || 'Lunch Break';
            const breaks = normalizeTimetableBreaks(effectiveSettings);

            // If className provided, generate single-class weekly PDF
            if (className) {
                const secNorm = section || 'A';
                const timetables = await fetchTimetablesWithSchoolGridFallback(req.schoolId!, className, secNorm);
                
                // Fetch class for teacher name
                const cls = await Class.findOne({ schoolId: req.schoolId, className, section: secNorm }).populate('classTeacherId', 'name');
                const classTeacherName = (cls as any)?.classTeacherId?.name;

                const days = (timetables as any[]).map((t) => ({
                    dayOfWeek: t.dayOfWeek,
                    slots: (t.slots || []).map((s: any) => ({
                        startTime: s.startTime,
                        endTime: s.endTime,
                        subject: s.subject,
                        title: s.title,
                        type: s.type,
                        teacherName: s.teacherId?.name,
                    })),
                }));

                const buffer = await generateTimetablePDF({
                    school,
                    sessionYear: sessionYear || '2025–26',
                    className,
                    section: secNorm,
                    classTeacherName,
                    periodCount,
                    lunchAfterPeriod,
                    firstPeriodStart,
                    periodDurationMinutes,
                    lunchBreakDuration,
                    breakLabel,
                    breaks,
                    days,
                });

                res.setHeader('Content-Type', 'application/pdf');
                const isPreview = req.query.preview === '1' || req.query.preview === 'true';
                res.setHeader('Content-Disposition', isPreview ? 'inline' : `attachment; filename=timetable-${className}-${secNorm}.pdf`);
                return res.send(buffer);
            }

            const grid = await SchoolTimetableGrid.findOne({ schoolId: req.schoolId, isActive: true })
                .populate('rows.cells.teacherId', 'name')
                .lean();
            const rows = ((grid as any)?.rows || []).map((r: any) => {
                const section =
                    r.section != null && String(r.section).trim() !== ''
                        ? String(r.section).trim().toUpperCase()
                        : 'A';
                const classLabel = `${r.className}-${section}`;
                return {
                    className: classLabel,
                    cells: (r.cells || []).map((c: any) => {
                        const cell = c || {};
                        return { subject: cell.subject ?? '', teacherName: cell.teacherId?.name };
                    }),
                };
            });
            const buffer = await generateSchoolTimetablePDF({
                school,
                sessionYear,
                periodCount,
                lunchAfterPeriod,
                firstPeriodStart,
                periodDurationMinutes,
                lunchBreakDuration,
                breakLabel,
                breaks,
                rows,
            });
            res.setHeader('Content-Type', 'application/pdf');
            const isPreview = req.query.preview === '1' || req.query.preview === 'true';
            res.setHeader('Content-Disposition', isPreview ? 'inline' : 'attachment; filename=timetable.pdf');
            res.send(buffer);
        } catch (error) {
            return next(error);
        }
    }

    async getTimetables(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const rawClass = (req.query.className || req.query.class) as string | undefined;
            const rawSection = req.query.section as string | undefined;
            const className = rawClass != null ? String(rawClass).trim() : undefined;
            const section =
                rawSection != null && String(rawSection).trim() !== ''
                    ? String(rawSection).trim().toUpperCase()
                    : undefined;

            const timetables = await fetchTimetablesWithSchoolGridFallback(req.schoolId, className, section);
            return sendResponse(res, timetables, 'Timetables retrieved', 200);
        } catch (error) {
            return next(error);
        }
    }

    /** Student app: timetable for logged-in student's class/section only (ignores query params). */
    async getTimetablesForCurrentStudent(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const st = req.student;
            if (!st) {
                return next(new ErrorResponse('Not authorized', 403));
            }
            const schoolId = st.schoolId?.toString();
            const className = String(st.class || '').trim();
            const section =
                st.section != null && String(st.section).trim() !== ''
                    ? String(st.section).trim().toUpperCase()
                    : 'A';

            if (!className) {
                return sendResponse(res, [], 'Timetables retrieved', 200);
            }

            const timetables = await fetchTimetablesWithSchoolGridFallback(schoolId, className, section);
            return sendResponse(res, timetables, 'Timetables retrieved', 200);
        } catch (error) {
            return next(error);
        }
    }

    async getTimetableByClass(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const classId = req.params.classId;
            const sectionFromQuery = req.query.section as string | undefined;
            const cls = await Class.findOne({ _id: classId, schoolId: req.schoolId });
            if (!cls) return next(new ErrorResponse('Class not found', 404));
            const sectionNorm =
                (sectionFromQuery != null && String(sectionFromQuery).trim() !== ''
                    ? String(sectionFromQuery).trim()
                    : String((cls as any).section || 'A').trim()
                ).toUpperCase() || 'A';

            const filter = {
                schoolId: req.schoolId,
                className: cls.className,
                section: sectionNorm,
                isActive: true,
            };
            let timetables: any[] = await Timetable.find(filter)
                .populate('slots.teacherId', 'name')
                .sort({ dayOfWeek: 1 })
                .lean();

            const useGrid =
                req.schoolId &&
                (!timetables.length || !legacyTimetableHasDisplayableSlots(timetables));
            if (useGrid && req.schoolId) {
                const fromGrid = await timetablesFromSchoolGrid(
                    req.schoolId,
                    String(cls.className),
                    sectionNorm
                );
                if (fromGrid.length > 0) {
                    timetables = fromGrid;
                }
            }

            const days = (timetables as any[]).map((t) => ({
                dayOfWeek: t.dayOfWeek,
                slots: (t.slots || []).map((s: any) => ({
                    startTime: s.startTime,
                    endTime: s.endTime,
                    subject: s.subject,
                    title: s.title,
                    type: s.type,
                    teacherId: s.teacherId?._id ?? s.teacherId,
                    teacherName: typeof s.teacherId === 'object' && s.teacherId?.name ? s.teacherId.name : undefined,
                })),
            }));
            return sendResponse(
                res,
                { class: cls, className: cls.className, section: sectionNorm, days },
                'Timetable retrieved',
                200
            );
        } catch (error) {
            return next(error);
        }
    }

    async upsertTimetable(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const { className, section, dayOfWeek, slots, sessionId } = req.body;
            const sec = section || 'A';
            const day = Number(dayOfWeek);
            if (day < 0 || day > 6 || isNaN(day)) return next(new ErrorResponse('dayOfWeek must be 0–6', 400));
            // Validate against configured working days
            const settingsForValidation = await TimetableSettings.findOne({ schoolId: req.schoolId, isActive: true }).lean();
            const WORKING_DAYS_MAP: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
            const configuredDays: string[] = settingsForValidation?.workingDays?.length
                ? settingsForValidation.workingDays
                : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
            const allowedNums = configuredDays.map((d) => WORKING_DAYS_MAP[d]).filter((n) => n !== undefined);
            if (!allowedNums.includes(day)) {
                return next(new ErrorResponse(`Day ${day} is not a configured working day for this school`, 400));
            }

            const conflicts = await getTeacherConflicts(req.schoolId!, day, slots || [], className, sec);
            if (conflicts.length > 0) {
                return res.status(400).json({ success: false, message: 'Teacher conflict', conflicts });
            }

            const existing = await Timetable.findOne({
                schoolId: req.schoolId,
                className,
                section: sec,
                dayOfWeek: day,
            });
            const payload: any = {
                schoolId: req.schoolId,
                className,
                section: sec,
                dayOfWeek: day,
                slots: slots || [],
                isActive: true,
            };
            if (sessionId) payload.sessionId = sessionId;
            let doc;
            if (existing) {
                doc = await Timetable.findByIdAndUpdate(existing._id, payload, { new: true })
                    .populate('slots.teacherId', 'name');
            } else {
                doc = await Timetable.create(payload);
            }
            return sendResponse(res, doc, 'Timetable saved', 200);
        } catch (error) {
            return next(error);
        }
    }

    async createTimetable(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const { className, section, days } = req.body;
            const sec = section || 'A';
            const sessionId = req.body.sessionId || null;
            const created: any[] = [];
            for (let dayOfWeek = 1; dayOfWeek <= 5; dayOfWeek++) {
                const dayData = (days || []).find((d: any) => Number(d.dayOfWeek) === dayOfWeek);
                const slots = dayData?.slots || [];
                const conflicts = await getTeacherConflicts(req.schoolId!, dayOfWeek, slots, className, sec);
                if (conflicts.length > 0) {
                    return res.status(400).json({ success: false, message: 'Teacher conflict', conflicts });
                }
                const existing = await Timetable.findOne({
                    schoolId: req.schoolId,
                    className,
                    section: sec,
                    dayOfWeek,
                });
                const payload: any = { schoolId: req.schoolId, className, section: sec, dayOfWeek, slots, isActive: true };
                if (sessionId) payload.sessionId = sessionId;
                if (existing) {
                    const doc = await Timetable.findByIdAndUpdate(existing._id, payload, { new: true }).populate('slots.teacherId', 'name');
                    created.push(doc);
                } else {
                    const doc = await Timetable.create(payload);
                    created.push(await Timetable.findById(doc._id).populate('slots.teacherId', 'name'));
                }
            }
            return sendResponse(res, created, 'Timetable created', 201);
        } catch (error) {
            return next(error);
        }
    }

    async updateTimetable(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const id = req.params.id;
            const { slots } = req.body;
            const existing = await Timetable.findOne({ _id: id, schoolId: req.schoolId });
            if (!existing) return next(new ErrorResponse('Timetable not found', 404));
            if (slots) {
                const conflicts = await getTeacherConflicts(
                    req.schoolId!,
                    existing.dayOfWeek,
                    slots,
                    existing.className,
                    existing.section
                );
                if (conflicts.length > 0) {
                    return res.status(400).json({ success: false, message: 'Teacher conflict', conflicts });
                }
                existing.slots = slots;
                await existing.save();
            }
            const doc = await Timetable.findById(existing._id).populate('slots.teacherId', 'name');
            return sendResponse(res, doc, 'Timetable updated', 200);
        } catch (error) {
            return next(error);
        }
    }

    async deleteTimetable(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const doc = await Timetable.findOne({ _id: req.params.id, schoolId: req.schoolId });
            if (!doc) return next(new ErrorResponse('Timetable not found', 404));
            await Timetable.findByIdAndDelete(req.params.id);
            return sendResponse(res, { deleted: true }, 'Timetable deleted', 200);
        } catch (error) {
            return next(error);
        }
    }

    async printTimetable(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const classId = req.params.classId;
            const section = (req.query.section as string) || undefined;
            const cls = await Class.findOne({ _id: classId, schoolId: req.schoolId }).populate('classTeacherId', 'name');
            if (!cls) return next(new ErrorResponse('Class not found', 404));
            const filter: any = { schoolId: req.schoolId, className: cls.className, isActive: true };
            if (section) filter.section = section;
            const timetables = await Timetable.find(filter)
                .populate('slots.teacherId', 'name')
                .sort({ dayOfWeek: 1 })
                .lean();
            const school = await School.findById(req.schoolId);
            if (!school) return next(new ErrorResponse('School not found', 404));
            let sessionYear = '';
            const session = await Session.findOne({ schoolId: req.schoolId, isActive: true });
            if (session) sessionYear = (session as any).sessionYear?.replace('-', '–') || '';
            const settings = await TimetableSettings.findOne({ schoolId: req.schoolId, isActive: true });
            const settingsObj = settings ? settings.toObject() : null;
            const periodCount = settingsObj?.periodCount ?? 7;
            const lunchAfterPeriod = settingsObj?.lunchAfterPeriod ?? 4;
            const firstPeriodStart = settingsObj?.firstPeriodStart || '08:00';
            const periodDurationMinutes = settingsObj?.periodDurationMinutes ?? 40;
            const lunchBreakDuration = settingsObj?.lunchBreakDuration ?? 40;
            const breakLabel = settingsObj?.breakLabel || 'Lunch Break';
            const breaks = normalizeTimetableBreaks(settingsObj || {});
            const days = (timetables as any[]).map((t) => ({
                dayOfWeek: t.dayOfWeek,
                slots: (t.slots || []).map((s: any) => ({
                    startTime: s.startTime,
                    endTime: s.endTime,
                    subject: s.subject,
                    title: s.title,
                    type: s.type,
                    teacherName: s.teacherId?.name,
                })),
            }));
            const sec = section || (cls as any).section || 'A';
            const classTeacherName = (cls as any).classTeacherId?.name;
            const buffer = await generateTimetablePDF({
                school,
                sessionYear: sessionYear || '2025–26',
                className: cls.className,
                section: sec,
                classTeacherName,
                periodCount,
                lunchAfterPeriod,
                firstPeriodStart,
                periodDurationMinutes,
                lunchBreakDuration,
                breakLabel,
                breaks,
                days,
            });
            res.setHeader('Content-Type', 'application/pdf');
            const isPreview = req.query.preview === '1' || req.query.preview === 'true';
            res.setHeader(
                'Content-Disposition',
                isPreview ? 'inline' : `attachment; filename=timetable-${cls.className}-${sec}.pdf`
            );
            res.send(buffer);
        } catch (error) {
            return next(error);
        }
    }

    async saveVersion(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const { className, section } = req.body;
            const sec = section || 'A';
            const timetables = await Timetable.find({
                schoolId: req.schoolId,
                className,
                section: sec,
                isActive: true,
            })
                .populate('slots.teacherId', 'name')
                .sort({ dayOfWeek: 1 })
                .lean();
            const last = await TimetableVersion.findOne({
                schoolId: req.schoolId,
                className,
                section: sec,
            })
                .sort({ version: -1 })
                .lean();
            const version = (last as any)?.version ? (last as any).version + 1 : 1;
            const days = (timetables as any[]).map((t) => ({
                dayOfWeek: t.dayOfWeek,
                slots: (t.slots || []).map((s: any) => ({
                    startTime: s.startTime,
                    endTime: s.endTime,
                    subject: s.subject,
                    teacherId: s.teacherId?._id,
                    teacherName: s.teacherId?.name,
                    type: s.type,
                    title: s.title,
                })),
            }));
            await TimetableVersion.create({
                schoolId: req.schoolId,
                className,
                section: sec,
                version,
                days,
                isLocked: false,
            });
            return sendResponse(res, { version }, 'Version saved', 201);
        } catch (error) {
            return next(error);
        }
    }

    async getVersions(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const { className, section } = req.query;
            const filter: any = { schoolId: req.schoolId };
            if (className) filter.className = className;
            if (section) filter.section = section;
            const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
            const limit = Math.min(parseInt(req.query.limit as string, 10) || 50, 200);
            const skip = (page - 1) * limit;
            const [versions, total] = await Promise.all([
                TimetableVersion.find(filter)
                    .sort({ className: 1, section: 1, version: -1 })
                    .skip(skip)
                    .limit(limit)
                    .lean(),
                TimetableVersion.countDocuments(filter),
            ]);
            res.setHeader('X-Total-Count', String(total));
            res.setHeader('X-Page', String(page));
            res.setHeader('X-Limit', String(limit));
            return sendResponse(res, versions, 'Versions retrieved', 200);
        } catch (error) {
            return next(error);
        }
    }

    async lockVersion(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const id = req.params.id;
            const doc = await TimetableVersion.findOne({ _id: id, schoolId: req.schoolId });
            if (!doc) return next(new ErrorResponse('Version not found', 404));
            doc.isLocked = true;
            await doc.save();
            return sendResponse(res, doc, 'Version locked', 200);
        } catch (error) {
            return next(error);
        }
    }

    async copyFromSession(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const { fromSessionId, toSessionId, className, section } = req.body;
            const sec = section || 'A';
            const fromTt = await Timetable.find({
                schoolId: req.schoolId,
                sessionId: fromSessionId,
                className,
                section: sec,
                isActive: true,
            }).lean();
            if (!fromTt.length) return next(new ErrorResponse('No timetable found for source session/class', 404));
            for (const row of fromTt as any[]) {
                await Timetable.findOneAndUpdate(
                    {
                        schoolId: req.schoolId,
                        sessionId: toSessionId,
                        className,
                        section: sec,
                        dayOfWeek: row.dayOfWeek,
                    },
                    { $set: { slots: row.slots } },
                    { upsert: true, new: true }
                );
            }
            return sendResponse(res, { copied: true }, 'Timetable copied to session', 200);
        } catch (error) {
            return next(error);
        }
    }
}

export default new TimetableController();
