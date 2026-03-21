// @ts-ignore
import PDFDocument from 'pdfkit';
import { ISchool } from '../types';
import { fetchImageBuffer } from '../utils/fetchImage';
import { buildTimetableColumns, normalizeTimetableBreaks, TimetableBreakInput } from '../utils/timetableSchedule';

const MARGIN = 28;
const PAGE_WIDTH = 842;  // A4 landscape
const CONTENT_WIDTH = PAGE_WIDTH - 2 * MARGIN;
const LOGO_SIZE = 36;
const HEADER_TOP = 20;

const DAYS = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

function formatTime(s: string): string {
    if (!s) return '–';
    const parts = s.split(':');
    if (parts.length >= 2) return `${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')}`;
    return s;
}

export interface TimetablePDFOptions {
    school: ISchool;
    sessionYear?: string;
    className: string;
    section: string;
    classTeacherName?: string;
    periodCount: number;
    lunchAfterPeriod: number;
    firstPeriodStart: string;
    periodDurationMinutes: number;
    lunchBreakDuration: number;
    breakLabel?: string;
    /** When set, drives all break columns (else derived from lunch* + breakLabel) */
    breaks?: TimetableBreakInput[];
    days: { dayOfWeek: number; slots: { startTime: string; endTime: string; subject?: string; teacherName?: string; type: string; title?: string }[] }[];
}

export async function generateTimetablePDF(options: TimetablePDFOptions): Promise<Buffer> {
    const {
        school,
        sessionYear = '2025–26',
        className,
        section,
        classTeacherName,
        periodCount,
        lunchAfterPeriod,
        firstPeriodStart,
        periodDurationMinutes,
        lunchBreakDuration,
        breakLabel = 'Lunch Break',
        breaks: breaksOpt,
        days,
    } = options;

    const breaksResolved =
        breaksOpt !== undefined
            ? breaksOpt
            : normalizeTimetableBreaks({
                  lunchAfterPeriod,
                  lunchBreakDuration,
                  breakLabel,
              });
    const columnDefs = buildTimetableColumns(
        periodCount,
        firstPeriodStart,
        periodDurationMinutes,
        breaksResolved
    ).map((c) =>
        c.kind === 'break'
            ? {
                  label: c.label.trim().toUpperCase(),
                  time: `${c.durationMinutes} min`,
                  isBreak: true as const,
                  breakDisplay: c.label.trim().toUpperCase(),
              }
            : {
                  label: c.label,
                  time: `${formatTime(c.startTime)} – ${formatTime(c.endTime)}`,
                  isBreak: false as const,
                  startTime: c.startTime,
              }
    );

    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: MARGIN, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));

    const [logoBuf, sigBuf, stampBuf] = await Promise.all([
        fetchImageBuffer(school.logo),
        fetchImageBuffer((school as any).principalSignature),
        fetchImageBuffer((school as any).stamp),
    ]);

    let y = HEADER_TOP;

    // Logo top left
    if (logoBuf) {
        try {
            doc.image(logoBuf, MARGIN, y, { width: LOGO_SIZE, height: LOGO_SIZE });
        } catch {
            doc.rect(MARGIN, y, LOGO_SIZE, LOGO_SIZE).fill('#374151');
            doc.fillColor('#fff').fontSize(12).font('Helvetica-Bold').text('S', MARGIN + 10, y + 10, { width: 18 });
            doc.fillColor('#000');
        }
    } else {
        doc.rect(MARGIN, y, LOGO_SIZE, LOGO_SIZE).fill('#374151');
        doc.fillColor('#fff').fontSize(12).font('Helvetica-Bold').text('S', MARGIN + 10, y + 10, { width: 18 });
        doc.fillColor('#000');
    }

    // School name center
    doc.fontSize(16).font('Helvetica-Bold');
    doc.text(school.schoolName || 'School Name', MARGIN, y, { width: CONTENT_WIDTH, align: 'center' });
    y += 18;
    doc.fontSize(9).font('Helvetica');
    const addr = [school.address?.street, school.address?.city, school.address?.state, school.address?.pincode].filter(Boolean).join(', ');
    doc.text(addr || '—', MARGIN, y, { width: CONTENT_WIDTH, align: 'center' });
    y += 12;
    const contact = [school.phone, school.email].filter(Boolean).join(' | ');
    doc.text(contact || '—', MARGIN, y, { width: CONTENT_WIDTH, align: 'center' });
    y += 14;

    // Session & Class top right
    doc.fontSize(10).font('Helvetica');
    doc.text(`Session: ${sessionYear}`, PAGE_WIDTH - MARGIN - 120, HEADER_TOP, { width: 120, align: 'right' });
    doc.text(`Class: ${className} ${section}`.trim(), PAGE_WIDTH - MARGIN - 120, HEADER_TOP + 12, { width: 120, align: 'right' });
    y += 4;

    doc.moveTo(MARGIN, y).lineTo(PAGE_WIDTH - MARGIN, y).stroke();
    y += 14;

    const periodLabels = columnDefs;
    const cellW = (CONTENT_WIDTH - 52) / Math.max(1, periodLabels.length);
    const dayColW = 50;
    const cellH = 22;
    const headerH = 32;

    // Table header row: Day | P1 (time) | P2 | ... | LUNCH | ...
    const tableTop = y;
    doc.rect(MARGIN, tableTop, dayColW, headerH).fillAndStroke('#374151', '#374151');
    doc.fillColor('#ffffff').fontSize(9).font('Helvetica-Bold');
    doc.text('Day', MARGIN + 4, tableTop + 10, { width: dayColW - 8 });
    doc.fillColor('#000000');

    let x = MARGIN + dayColW;
    periodLabels.forEach((p) => {
        doc.rect(x, tableTop, cellW, headerH).fillAndStroke(p.isBreak ? '#fef3c7' : '#f3f4f6', '#e5e7eb');
        doc.fillColor(p.isBreak ? '#92400e' : '#000000');
        doc.font('Helvetica-Bold').fontSize(8);
        doc.text(p.label, x + 4, tableTop + 4, { width: cellW - 8, align: 'center' });
        doc.font('Helvetica').fontSize(7);
        doc.text(p.time, x + 4, tableTop + 14, { width: cellW - 8, align: 'center' });
        doc.fillColor('#000000');
        x += cellW;
    });
    y = tableTop + headerH;

    const dayIndexToSlots = (days || []).reduce((acc: Record<number, any[]>, d: any) => {
        acc[d.dayOfWeek] = d.slots || [];
        return acc;
    }, {});

    for (let dayNum = 1; dayNum <= 5; dayNum++) {
        const slots = dayIndexToSlots[dayNum] || [];
        const slotByStart = slots.reduce((acc: Record<string, any>, s: any) => {
            acc[s.startTime || ''] = s;
            return acc;
        }, {});

        doc.rect(MARGIN, y, dayColW, cellH).stroke('#e5e7eb');
        doc.font('Helvetica-Bold').fontSize(9);
        doc.text(DAYS[dayNum], MARGIN + 4, y + 6, { width: dayColW - 8 });
        x = MARGIN + dayColW;

        periodLabels.forEach((p) => {
            if (p.isBreak) {
                doc.rect(x, y, cellW, cellH).fillAndStroke('#fef3c7', '#e5e7eb');
                doc.font('Helvetica').fontSize(8).fillColor('#92400e');
                doc.text(p.breakDisplay, x + 4, y + 8, { width: cellW - 8, align: 'center' });
                doc.fillColor('#000000');
            } else {
                const start = p.startTime || '';
                const slot = slotByStart[start] || slotByStart[start.replace(/^(\d):/, '0$1:')];
                doc.rect(x, y, cellW, cellH).stroke('#e5e7eb');
                if (slot && slot.type !== 'lunch') {
                    doc.font('Helvetica-Bold').fontSize(8);
                    doc.text((slot.subject || slot.title || '—').substring(0, 14), x + 3, y + 3, { width: cellW - 6 });
                    doc.font('Helvetica').fontSize(6).fillColor('#6b7280');
                    doc.text((slot.teacherName || '').substring(0, 16), x + 3, y + 13, { width: cellW - 6 });
                    doc.fillColor('#000000');
                }
            }
            x += cellW;
        });
        y += cellH;
    }

    y += 16;
    const footerY = y;
    doc.font('Helvetica').fontSize(9);
    if (sigBuf) {
        try {
            doc.image(sigBuf, MARGIN, footerY, { width: 70, height: 28 });
        } catch {
            doc.text(classTeacherName ? `Class Teacher: ${classTeacherName}` : 'Class Teacher', MARGIN, footerY);
        }
    } else {
        doc.text(classTeacherName ? `Class Teacher: ${classTeacherName}` : 'Class Teacher', MARGIN, footerY);
    }
    if (stampBuf) {
        try {
            doc.image(stampBuf, PAGE_WIDTH - MARGIN - 80, footerY, { width: 80, height: 32 });
        } catch {
            doc.text('Principal', PAGE_WIDTH - MARGIN - 60, footerY, { width: 60, align: 'right' });
        }
    } else {
        doc.text('Principal', PAGE_WIDTH - MARGIN - 60, footerY, { width: 60, align: 'right' });
    }
    y += 36;
    doc.fontSize(8).fillColor('#6b7280');
    doc.text('This is a computer generated timetable.', MARGIN, y, { width: CONTENT_WIDTH, align: 'center' });

    doc.end();
    return new Promise<Buffer>((resolve, reject) => {
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);
    });
}

// School-wide timetable: rows = classes, columns = periods. Same schedule Mon–Sat.
export interface SchoolTimetablePDFOptions {
    school: ISchool;
    sessionYear?: string;
    periodCount: number;
    lunchAfterPeriod: number;
    firstPeriodStart: string;
    periodDurationMinutes: number;
    lunchBreakDuration: number;
    breakLabel?: string;
    breaks?: TimetableBreakInput[];
    rows: { className: string; cells: { subject?: string; teacherName?: string }[] }[];
}

export async function generateSchoolTimetablePDF(options: SchoolTimetablePDFOptions): Promise<Buffer> {
    const {
        school,
        sessionYear = '2025–26',
        periodCount,
        lunchAfterPeriod,
        firstPeriodStart,
        periodDurationMinutes,
        lunchBreakDuration,
        breakLabel = 'Lunch Break',
        breaks: breaksOpt,
        rows = [],
    } = options;

    const breaksResolved =
        breaksOpt !== undefined
            ? breaksOpt
            : normalizeTimetableBreaks({
                  lunchAfterPeriod,
                  lunchBreakDuration,
                  breakLabel,
              });
    const schoolColumnDefs = buildTimetableColumns(
        periodCount,
        firstPeriodStart,
        periodDurationMinutes,
        breaksResolved
    ).map((c) =>
        c.kind === 'break'
            ? {
                  label: c.label.trim().toUpperCase(),
                  time: `${c.durationMinutes} min`,
                  isBreak: true as const,
                  breakDisplay: c.label.trim().toUpperCase(),
              }
            : {
                  label: c.label,
                  time: `${formatTime(c.startTime)} – ${formatTime(c.endTime)}`,
                  isBreak: false as const,
              }
    );

    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: MARGIN, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));

    const [logoBuf, sigBuf, stampBuf] = await Promise.all([
        fetchImageBuffer(school.logo),
        fetchImageBuffer((school as any).principalSignature),
        fetchImageBuffer((school as any).stamp),
    ]);

    let y = HEADER_TOP;

    if (logoBuf) {
        try {
            doc.image(logoBuf, MARGIN, y, { width: LOGO_SIZE, height: LOGO_SIZE });
        } catch {
            doc.rect(MARGIN, y, LOGO_SIZE, LOGO_SIZE).fill('#374151');
            doc.fillColor('#fff').fontSize(12).font('Helvetica-Bold').text('S', MARGIN + 10, y + 10, { width: 18 });
            doc.fillColor('#000');
        }
    } else {
        doc.rect(MARGIN, y, LOGO_SIZE, LOGO_SIZE).fill('#374151');
        doc.fillColor('#fff').fontSize(12).font('Helvetica-Bold').text('S', MARGIN + 10, y + 10, { width: 18 });
        doc.fillColor('#000');
    }

    doc.fontSize(16).font('Helvetica-Bold');
    doc.text(school.schoolName || 'School Name', MARGIN, y, { width: CONTENT_WIDTH, align: 'center' });
    y += 18;
    doc.fontSize(9).font('Helvetica');
    const addr = [school.address?.street, school.address?.city, school.address?.state, school.address?.pincode].filter(Boolean).join(', ');
    doc.text(addr || '—', MARGIN, y, { width: CONTENT_WIDTH, align: 'center' });
    y += 12;
    const contact = [school.phone, school.email].filter(Boolean).join(' | ');
    doc.text(contact || '—', MARGIN, y, { width: CONTENT_WIDTH, align: 'center' });
    y += 14;

    doc.fontSize(10).font('Helvetica');
    doc.text(`Session: ${sessionYear}`, PAGE_WIDTH - MARGIN - 140, HEADER_TOP, { width: 140, align: 'right' });
    doc.text('Mon–Sat (same schedule)', PAGE_WIDTH - MARGIN - 140, HEADER_TOP + 12, { width: 140, align: 'right' });
    y += 4;

    doc.moveTo(MARGIN, y).lineTo(PAGE_WIDTH - MARGIN, y).stroke();
    y += 14;

    const periodLabels = schoolColumnDefs;
    const classColW = 56;
    const periodColW = (CONTENT_WIDTH - classColW) / Math.max(1, periodLabels.length);
    const cellH = 20;
    const headerH = 28;

    const tableTop = y;
    doc.rect(MARGIN, tableTop, classColW, headerH).fillAndStroke('#374151', '#374151');
    doc.fillColor('#ffffff').fontSize(9).font('Helvetica-Bold');
    doc.text('Class', MARGIN + 4, tableTop + 8, { width: classColW - 8 });
    doc.fillColor('#000000');

    let x = MARGIN + classColW;
    periodLabels.forEach((p) => {
        doc.rect(x, tableTop, periodColW, headerH).fillAndStroke(p.isBreak ? '#fef3c7' : '#f3f4f6', '#e5e7eb');
        doc.fillColor(p.isBreak ? '#92400e' : '#000000');
        doc.font('Helvetica-Bold').fontSize(7);
        doc.text(p.label, x + 2, tableTop + 2, { width: periodColW - 4, align: 'center' });
        doc.font('Helvetica').fontSize(6);
        doc.text(p.time, x + 2, tableTop + 12, { width: periodColW - 4, align: 'center' });
        doc.fillColor('#000000');
        x += periodColW;
    });
    y = tableTop + headerH;

    rows.forEach((row) => {
        doc.rect(MARGIN, y, classColW, cellH).stroke('#e5e7eb');
        doc.font('Helvetica-Bold').fontSize(8);
        doc.text(row.className, MARGIN + 4, y + 5, { width: classColW - 8 });
        x = MARGIN + classColW;
        periodLabels.forEach((colDef, idx) => {
            const cell = row.cells[idx];
            if (colDef.isBreak) {
                doc.rect(x, y, periodColW, cellH).fillAndStroke('#fef3c7', '#e5e7eb');
                doc.font('Helvetica').fontSize(7).fillColor('#92400e');
                doc.text(colDef.breakDisplay, x + 2, y + 6, { width: periodColW - 4, align: 'center' });
                doc.fillColor('#000000');
            } else {
                doc.rect(x, y, periodColW, cellH).stroke('#e5e7eb');
                if (cell?.subject) {
                    doc.font('Helvetica-Bold').fontSize(7);
                    doc.text((cell.subject || '').substring(0, 12), x + 2, y + 2, { width: periodColW - 4 });
                    doc.font('Helvetica').fontSize(6).fillColor('#6b7280');
                    doc.text((cell.teacherName || '').substring(0, 14), x + 2, y + 11, { width: periodColW - 4 });
                    doc.fillColor('#000000');
                }
            }
            x += periodColW;
        });
        y += cellH;
    });

    y += 14;
    const footerY = y;
    if (sigBuf) {
        try {
            doc.image(sigBuf, MARGIN, footerY, { width: 70, height: 28 });
        } catch {
            doc.font('Helvetica').fontSize(9).text('Authorized', MARGIN, footerY);
        }
    } else {
        doc.font('Helvetica').fontSize(9).text('Authorized', MARGIN, footerY);
    }
    if (stampBuf) {
        try {
            doc.image(stampBuf, PAGE_WIDTH - MARGIN - 80, footerY, { width: 80, height: 32 });
        } catch {
            doc.text('Principal', PAGE_WIDTH - MARGIN - 60, footerY, { width: 60, align: 'right' });
        }
    } else {
        doc.text('Principal', PAGE_WIDTH - MARGIN - 60, footerY, { width: 60, align: 'right' });
    }
    y += 36;
    doc.fontSize(8).fillColor('#6b7280');
    doc.text('This is a computer generated timetable. Same schedule Monday–Saturday.', MARGIN, y, { width: CONTENT_WIDTH, align: 'center' });

    doc.end();
    return new Promise<Buffer>((resolve, reject) => {
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);
    });
}
