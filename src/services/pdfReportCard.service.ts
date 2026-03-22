// @ts-ignore
import PDFDocument from 'pdfkit';
import { ISchool } from '../types';
import { fetchImageBuffer } from '../utils/fetchImage';

const PW = 595; // A4 width
const PH = 842; // A4 height
const M = 36;
const CW = PW - 2 * M;

export interface ReportCardOptions {
    school: ISchool;
    sessionYear?: string;
    /** Active students in this class & section (for "Rank X out of Y") */
    classStrength?: number;
    student: {
        firstName?: string;
        lastName?: string;
        admissionNumber?: string;
        class?: string;
        section?: string;
        rollNumber?: string | number;
        fatherName?: string;
        motherName?: string;
        dateOfBirth?: Date | string;
        photo?: string;
    };
    examResults: {
        examTitle: string;
        examType?: string;
        /** For ordering the rank progress chart (same as student profile) */
        examDate?: Date | string;
        subjects: { subject: string; maxMarks: number; obtainedMarks: number }[];
        totalMarks: number;
        totalObtained: number;
        percentage: number;
        grade: string;
        rank?: number;
    }[];
}

function truncLabel(s: string, max: number): string {
    if (s.length <= max) return s;
    return `${s.slice(0, Math.max(1, max - 1))}…`;
}

/** Line chart: rank (Y, 1 = top) vs exams (X). Static labels replace web hover. */
function drawRankProgressChart(doc: any, yStart: number, examResults: ReportCardOptions['examResults'], cw: number, m: number): number {
    const withIndex = examResults
        .map((e, i) => ({ e, i }))
        .filter(({ e }) => e.rank != null && Number(e.rank) > 0)
        .map(({ e, i }) => ({
            title: e.examTitle || 'Exam',
            rank: Number(e.rank),
            t: e.examDate ? new Date(e.examDate as Date).getTime() : NaN,
            i,
        }));
    if (withIndex.length === 0) return yStart;

    const points = [...withIndex].sort((a, b) => {
        if (Number.isFinite(a.t) && Number.isFinite(b.t) && a.t !== b.t) return a.t - b.t;
        return a.i - b.i;
    });

    const titleBlockH = 26;
    const chartH = 132;
    const xAxisH = 36;
    const bottomPad = 6;
    const chartPadL = 26;
    const chartPadR = 8;
    const chartTop = yStart + titleBlockH;
    const chartLeft = m + chartPadL;
    const chartW = cw - chartPadL - chartPadR;
    const chartBottom = chartTop + chartH;

    doc.fontSize(10).font('Helvetica-Bold').fillColor('#1a237e');
    doc.text('Exam rank progress', m, yStart);
    doc.fontSize(7).font('Helvetica').fillColor('#666666');
    doc.text('Student rank in each assessment (lower is better). Labels show exam name and rank.', m, yStart + 13, { width: cw });

    doc.rect(chartLeft, chartTop, chartW, chartH).fill('#fafbff');
    doc.lineWidth(0.4).strokeColor('#dee2e6').rect(chartLeft, chartTop, chartW, chartH).stroke();

    const ranks = points.map(p => p.rank);
    const maxR = Math.max(...ranks, 1);
    const minR = 1;

    const rankToY = (r: number) => {
        if (maxR <= minR) return (chartTop + chartBottom) / 2;
        return chartTop + ((r - minR) / (maxR - minR)) * chartH;
    };

    const n = points.length;
    const indexToX = (idx: number) => {
        if (n <= 1) return chartLeft + chartW / 2;
        return chartLeft + (idx / (n - 1)) * chartW;
    };

    doc.lineWidth(0.35).strokeColor('#e8ecf4');
    for (let r = minR; r <= maxR; r++) {
        const yy = rankToY(r);
        doc.moveTo(chartLeft, yy).lineTo(chartLeft + chartW, yy).stroke();
    }

    doc.fontSize(6.5).font('Helvetica').fillColor('#888888');
    for (let r = minR; r <= maxR; r++) {
        const yy = rankToY(r);
        doc.text(String(r), m + 4, yy - 4, { width: chartPadL - 8, align: 'right' });
    }
    // Omit a sideways "Rank" label here — it sat on the chart mid-left and overlapped the first
    // X-axis exam label (e.g. "ct3"). The section title already names this as rank progress.

    doc.lineWidth(1.4).strokeColor('#4f46e5');
    for (let i = 0; i < n; i++) {
        const x = indexToX(i);
        const yy = rankToY(points[i].rank);
        if (i === 0) doc.moveTo(x, yy);
        else doc.lineTo(x, yy);
    }
    doc.stroke();

    const labelFont = n > 6 ? 5.5 : 6.5;
    for (let i = 0; i < n; i++) {
        const x = indexToX(i);
        const yy = rankToY(points[i].rank);
        doc.circle(x, yy, 3.2).fillAndStroke('#4f46e5', '#ffffff');
        doc.fontSize(labelFont).font('Helvetica').fillColor('#334155');
        const t1 = truncLabel(points[i].title, n > 5 ? 10 : 14);
        doc.text(t1, x - 34, chartBottom + 4, { width: 68, align: 'center' });
        doc.font('Helvetica-Bold').fillColor('#4f46e5');
        doc.text(`Rank ${points[i].rank}`, x - 34, chartBottom + 4 + (labelFont + 1), { width: 68, align: 'center' });
    }

    return chartBottom + xAxisH + bottomPad;
}

function fmtDate(d: Date | string | undefined): string {
    if (!d) return '—';
    const x = new Date(d);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${String(x.getDate()).padStart(2, '0')} ${months[x.getMonth()]} ${x.getFullYear()}`;
}

function logoPlaceholder(doc: any, x: number, y: number, sz: number) {
    doc.circle(x + sz / 2, y + sz / 2, sz / 2).fill('#1a237e');
    doc.fillColor('#ffffff').fontSize(14).font('Helvetica-Bold').text('S', x + sz / 2 - 5, y + sz / 2 - 9, { width: 12 });
    doc.fillColor('#000000');
}

function drawRow(doc: any, y: number, cols: { text: string; x: number; w: number; align?: string; bold?: boolean; color?: string }[], h: number, bg?: string) {
    if (bg) doc.rect(M, y, CW, h).fill(bg);
    cols.forEach(c => {
        doc.fontSize(8).font(c.bold ? 'Helvetica-Bold' : 'Helvetica').fillColor(c.color || '#333333');
        doc.text(c.text, c.x, y + 5, { width: c.w, align: (c.align as any) || 'left' });
    });
    doc.lineWidth(0.3).strokeColor('#dee2e6').moveTo(M, y + h).lineTo(M + CW, y + h).stroke();
}

export async function generateReportCardPDF(opts: ReportCardOptions): Promise<Buffer> {
    const { school, student, examResults, sessionYear, classStrength } = opts;
    const doc = new PDFDocument({ size: 'A4', margin: M, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));

    const [logoBuf, photoBuf, principalSigBuf] = await Promise.all([
        fetchImageBuffer(school.logo),
        fetchImageBuffer(student.photo),
        fetchImageBuffer((school as ISchool & { principalSignature?: string }).principalSignature),
    ]);

    let y = M;

    // ── DECORATIVE TOP BORDER ──
    doc.rect(0, 0, PW, 8).fill('#1a237e');
    doc.rect(0, 8, PW, 3).fill('#c62828');
    y = 20;

    // ── SCHOOL HEADER ──
    const LOGO_SZ = 50;
    if (logoBuf) {
        try { doc.image(logoBuf, M, y, { width: LOGO_SZ, height: LOGO_SZ }); }
        catch { logoPlaceholder(doc, M, y, LOGO_SZ); }
    } else { logoPlaceholder(doc, M, y, LOGO_SZ); }

    const schoolName = school.schoolName || 'School Name';
    const board = (school as any).board ? `Affiliated to ${(school as any).board}` : '';
    const addr = [school.address?.street, school.address?.city, school.address?.state].filter(Boolean).join(', ');

    doc.fontSize(16).font('Helvetica-Bold').fillColor('#1a237e');
    doc.text(schoolName, M + LOGO_SZ + 12, y + 2, { width: CW - LOGO_SZ - 12, align: 'center' });

    if (board) {
        doc.fontSize(8).font('Helvetica').fillColor('#666666');
        doc.text(board, M + LOGO_SZ + 12, y + 22, { width: CW - LOGO_SZ - 12, align: 'center' });
    }
    if (addr) {
        doc.fontSize(7.5).font('Helvetica').fillColor('#888888');
        doc.text(addr, M + LOGO_SZ + 12, y + (board ? 33 : 22), { width: CW - LOGO_SZ - 12, align: 'center' });
    }

    y += LOGO_SZ + 12;

    // ── REPORT CARD BANNER ──
    doc.rect(M, y, CW, 24).fill('#1a237e');
    doc.fontSize(11).font('Helvetica-Bold').fillColor('#ffffff');
    const bannerText = sessionYear ? `ACADEMIC REPORT CARD — Session ${sessionYear}` : 'ACADEMIC REPORT CARD';
    doc.text(bannerText, M, y + 6, { width: CW, align: 'center' });
    y += 32;

    // ── STUDENT DETAILS ──
    const PHOTO_W = 65;
    const PHOTO_H = 80;

    const studentName = `${student.firstName || ''} ${student.lastName || ''}`.trim() || '—';
    const detailRows: [string, string][] = [
        ['Student Name', studentName],
        ['Admission No.', student.admissionNumber || '—'],
        ['Class / Section', `${student.class || '—'} / ${student.section || '—'}`],
        ['Roll No.', String(student.rollNumber ?? '—')],
        ["Father's Name", student.fatherName || '—'],
        ["Mother's Name", student.motherName || '—'],
        ['Date of Birth', fmtDate(student.dateOfBirth)],
    ];

    // Photo (right side)
    const photoX = M + CW - PHOTO_W - 4;
    if (photoBuf) {
        try { doc.image(photoBuf, photoX, y, { width: PHOTO_W, height: PHOTO_H }); }
        catch {
            doc.rect(photoX, y, PHOTO_W, PHOTO_H).fillAndStroke('#f5f5f5', '#cccccc');
            doc.fontSize(7).fillColor('#999999').text('Photo', photoX, y + PHOTO_H / 2 - 5, { width: PHOTO_W, align: 'center' });
        }
    } else {
        doc.rect(photoX, y, PHOTO_W, PHOTO_H).fillAndStroke('#f5f5f5', '#cccccc');
        doc.fontSize(7).fillColor('#999999').text('Photo', photoX, y + PHOTO_H / 2 - 5, { width: PHOTO_W, align: 'center' });
    }
    doc.lineWidth(0.5).strokeColor('#cccccc').rect(photoX, y, PHOTO_W, PHOTO_H).stroke();

    const detailsW = CW - PHOTO_W - 14;
    const labelW = 90;
    const rowH = 16;

    detailRows.forEach((row, i) => {
        const bg = i % 2 === 0 ? '#f8f9ff' : '#ffffff';
        doc.rect(M, y, detailsW, rowH).fill(bg);
        doc.fontSize(8).font('Helvetica-Bold').fillColor('#1a237e');
        doc.text(`${row[0]}:`, M + 6, y + 4, { width: labelW });
        doc.font('Helvetica').fillColor('#333333');
        doc.text(row[1], M + labelW + 6, y + 4, { width: detailsW - labelW - 12 });
        y += rowH;
    });

    y = Math.max(y, M + LOGO_SZ + 12 + 32 + PHOTO_H) + 14;

    // ── EXAM RESULTS ──
    for (const exam of examResults) {
        if (y > PH - 180) {
            doc.addPage();
            y = M;
        }

        // Exam title bar
        doc.rect(M, y, CW, 20).fill('#f0f4ff');
        doc.lineWidth(2).strokeColor('#1a237e').moveTo(M, y).lineTo(M, y + 20).stroke();
        doc.fontSize(9).font('Helvetica-Bold').fillColor('#1a237e');
        doc.text(`${exam.examTitle}${exam.examType ? ` (${exam.examType.replace('_', ' ')})` : ''}`, M + 8, y + 5, { width: CW - 16 });
        y += 24;

        // Table header
        const subjectCol = M;
        const maxCol = M + CW * 0.5;
        const obtCol = M + CW * 0.65;
        const pctCol = M + CW * 0.8;
        const subW = CW * 0.5;
        const maxW = CW * 0.15;
        const obtW = CW * 0.15;
        const pctW = CW * 0.2;

        drawRow(doc, y, [
            { text: 'Subject', x: subjectCol + 6, w: subW - 6, bold: true, color: '#ffffff' },
            { text: 'Max Marks', x: maxCol, w: maxW, align: 'center', bold: true, color: '#ffffff' },
            { text: 'Obtained', x: obtCol, w: obtW, align: 'center', bold: true, color: '#ffffff' },
            { text: 'Percentage', x: pctCol, w: pctW, align: 'center', bold: true, color: '#ffffff' },
        ], 18, '#1a237e');
        y += 18;

        // Subject rows
        exam.subjects.forEach((sub, i) => {
            const pct = sub.maxMarks > 0 ? ((sub.obtainedMarks / sub.maxMarks) * 100).toFixed(1) : '0.0';
            const pctNum = parseFloat(pct);
            const pctColor = pctNum >= 60 ? '#16a34a' : pctNum >= 40 ? '#d97706' : '#dc2626';
            const bg = i % 2 === 0 ? '#fafbff' : '#ffffff';
            drawRow(doc, y, [
                { text: sub.subject, x: subjectCol + 6, w: subW - 6 },
                { text: String(sub.maxMarks), x: maxCol, w: maxW, align: 'center' },
                { text: String(sub.obtainedMarks), x: obtCol, w: obtW, align: 'center', bold: true },
                { text: `${pct}%`, x: pctCol, w: pctW, align: 'center', bold: true, color: pctColor },
            ], 16, bg);
            y += 16;
        });

        // Total row
        drawRow(doc, y, [
            { text: 'TOTAL', x: subjectCol + 6, w: subW - 6, bold: true, color: '#1a237e' },
            { text: String(exam.totalMarks), x: maxCol, w: maxW, align: 'center', bold: true, color: '#1a237e' },
            { text: String(exam.totalObtained), x: obtCol, w: obtW, align: 'center', bold: true, color: '#1a237e' },
            { text: `${exam.percentage.toFixed(1)}%`, x: pctCol, w: pctW, align: 'center', bold: true, color: '#1a237e' },
        ], 18, '#e8edf5');
        y += 22;

        // Grade & Rank summary
        doc.rect(M, y, CW / 2, 22).fill('#f0fdf4');
        doc.rect(M + CW / 2, y, CW / 2, 22).fill('#eff6ff');
        doc.fontSize(8).font('Helvetica-Bold');
        doc.fillColor('#16a34a').text(`Grade: ${exam.grade}`, M + 8, y + 6, { width: CW / 2 - 16 });
        const rankStr =
            exam.rank != null && exam.rank !== undefined
                ? classStrength != null && classStrength > 0
                    ? `Rank: ${exam.rank} out of ${classStrength}`
                    : `Rank: ${exam.rank}`
                : 'Rank: —';
        doc.fillColor('#2563eb').text(rankStr, M + CW / 2 + 8, y + 6, { width: CW / 2 - 16 });
        y += 30;
    }

    // ── OVERALL PERFORMANCE ──
    if (examResults.length > 0) {
        if (y > PH - 120) { doc.addPage(); y = M; }

        const avgPct = examResults.reduce((s, r) => s + r.percentage, 0) / examResults.length;
        const overallGrade = avgPct >= 90 ? 'A+' : avgPct >= 80 ? 'A' : avgPct >= 70 ? 'B+' : avgPct >= 60 ? 'B' : avgPct >= 50 ? 'C' : avgPct >= 40 ? 'D' : 'F';

        doc.rect(M, y, CW, 28).fill('#1a237e');
        doc.fontSize(10).font('Helvetica-Bold').fillColor('#ffffff');
        doc.text(`OVERALL PERFORMANCE — Average: ${avgPct.toFixed(1)}%  |  Grade: ${overallGrade}`, M, y + 8, { width: CW, align: 'center' });
        y += 36;
    }

    // ── EXAM RANK PROGRESS (same data as student profile graph) ──
    const hasRankData = examResults.some(e => e.rank != null && Number(e.rank) > 0);
    if (hasRankData) {
        const chartBlockMinH = 210;
        if (y > PH - chartBlockMinH) {
            doc.addPage();
            y = M;
        }
        y = drawRankProgressChart(doc, y, examResults, CW, M);
    }

    // ── SIGNATURE SECTION ──
    if (y > PH - 80) { doc.addPage(); y = M; }
    y = Math.max(y, PH - 100);

    // Order: Class Teacher | Parent/Guardian | Principal (with uploaded principal signature)
    const sigCols = ['Class Teacher', 'Parent/Guardian', 'Principal'];
    const sigColW = CW / 3;
    const SIG_IMG_W = Math.min(72, sigColW - 30);
    const SIG_IMG_H = 24;
    const lineY = y + 26;

    sigCols.forEach((label, i) => {
        const sx = M + i * sigColW;
        if (i === 2 && principalSigBuf) {
            try {
                doc.image(principalSigBuf, sx + (sigColW - SIG_IMG_W) / 2, y + 2, { width: SIG_IMG_W, height: SIG_IMG_H });
            } catch {
                /* fall through to line only */
            }
        }
        doc.lineWidth(0.7).strokeColor('#555').moveTo(sx + 15, lineY).lineTo(sx + sigColW - 15, lineY).stroke();
        doc.font('Helvetica').fontSize(7.5).fillColor('#555555');
        doc.text(label, sx, lineY + 4, { width: sigColW, align: 'center' });
    });

    // ── BOTTOM BORDER ──
    doc.rect(0, PH - 8, PW, 3).fill('#c62828');
    doc.rect(0, PH - 5, PW, 5).fill('#1a237e');

    doc.end();
    return new Promise<Buffer>((resolve, reject) => {
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);
    });
}
