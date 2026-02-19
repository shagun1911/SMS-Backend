// @ts-ignore - pdfkit may not have types
import PDFDocument from 'pdfkit';
import { ISchool } from '../types';
import { fetchImageBuffer } from '../utils/fetchImage';

// A4 = 595 × 842 pt. Two admit cards per page, each ~400 pt tall.
const PW = 595;
const CARD_H = 400;
const M = 22; // outer margin per card
const CW = PW - 2 * M;

export interface AdmitCardPDFOptions {
    school: ISchool;
    exam: {
        title: string;
        startDate?: Date;
        endDate?: Date;
        type?: string;
        sessionYear?: string;
    };
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
        phone?: string;
        photo?: string;
    };
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

/** Draw one admit card starting at yOffset from the top of the page */
async function drawCard(
    doc: any,
    logoBuf: Buffer | null,
    photoBuf: Buffer | null,
    opts: AdmitCardPDFOptions,
    yOffset: number
) {
    const { school, exam, student } = opts;
    const cardTop = yOffset;

    // ── CARD OUTER BORDER ─────────────────────────────────────────────────────
    doc.rect(M, cardTop + 4, CW, CARD_H - 8).lineWidth(1.5).strokeColor('#1a237e').stroke();

    let y = cardTop + 12;

    // ── SCHOOL HEADER ──────────────────────────────────────────────────────────
    const LOGO_SZ = 54;
    if (logoBuf) {
        try { doc.image(logoBuf, M + 8, y, { width: LOGO_SZ, height: LOGO_SZ }); }
        catch { logoPlaceholder(doc, M + 8, y, LOGO_SZ); }
    } else { logoPlaceholder(doc, M + 8, y, LOGO_SZ); }

    const schoolName = school.schoolName || 'School Name';
    const board = (school as any).board ? `Affiliated to ${(school as any).board}` : '';
    const addr = [school.address?.street, school.address?.city, school.address?.state].filter(Boolean).join(', ');
    const contact = [school.phone].filter(Boolean).join(' | ');

    doc.fontSize(15).font('Helvetica-Bold').fillColor('#c62828');
    doc.text(schoolName, M + LOGO_SZ + 18, y + 2, { width: CW - LOGO_SZ - 28, align: 'center' });

    if (board) {
        doc.fontSize(7.5).font('Helvetica').fillColor('#555555');
        doc.text(board, M + LOGO_SZ + 18, y + 21, { width: CW - LOGO_SZ - 28, align: 'center' });
    }

    doc.fontSize(8).font('Helvetica').fillColor('#333333');
    doc.text(`📍 ${addr || '—'}`, M + LOGO_SZ + 18, y + (board ? 33 : 23), { width: CW - LOGO_SZ - 28, align: 'center' });
    if (contact) {
        doc.text(`📞 ${contact}`, M + LOGO_SZ + 18, y + (board ? 45 : 35), { width: CW - LOGO_SZ - 28, align: 'center' });
    }

    y += LOGO_SZ + 8;

    // ── ADMIT CARD BANNER ──────────────────────────────────────────────────────
    const sessionLabel = exam.sessionYear || '';
    const examTitle = exam.title || 'Examination';
    const bannerText = sessionLabel
        ? `ADMIT CARD  ||  ${examTitle}  ||  Session: ${sessionLabel}`
        : `ADMIT CARD  ||  ${examTitle}`;

    doc.rect(M, y, CW, 20).fill('#212121');
    doc.fontSize(9).font('Helvetica-Bold').fillColor('#ffffff');
    doc.text(bannerText, M, y + 5, { width: CW, align: 'center' });
    y += 20;

    // ── STUDENT DETAILS + PHOTO ────────────────────────────────────────────────
    const PHOTO_W = 72;
    const PHOTO_H = 90;
    const detailsW = CW - PHOTO_W - 20;

    const studentName = `${student.firstName || ''} ${student.lastName || ''}`.trim() || '—';

    const detailRows: [string, string][] = [
        ['Name', studentName],
        ["Father's Name", student.fatherName || '—'],
        ["Mother's Name", student.motherName || '—'],
        ['Date of Birth', fmtDate(student.dateOfBirth)],
        ['Mobile', student.phone || '—'],
        ['Class / Section', `${student.class || '—'} / ${student.section || '—'}`],
        ['ID No', student.admissionNumber || '—'],
        ['Roll No', String(student.rollNumber ?? '—')],
    ];

    y += 6;
    const rowH = 18;
    const labelW = 100;

    // Photo box (right side)
    const photoX = M + CW - PHOTO_W - 8;
    const photoY = y;
    if (photoBuf) {
        try { doc.image(photoBuf, photoX, photoY, { width: PHOTO_W, height: PHOTO_H }); }
        catch {
            doc.rect(photoX, photoY, PHOTO_W, PHOTO_H).fillAndStroke('#f0f0f0', '#9e9e9e');
            doc.fontSize(8).fillColor('#9e9e9e').text('Photo', photoX, photoY + PHOTO_H / 2 - 6, { width: PHOTO_W, align: 'center' });
        }
    } else {
        doc.rect(photoX, photoY, PHOTO_W, PHOTO_H).fillAndStroke('#f0f0f0', '#9e9e9e');
        doc.fontSize(8).fillColor('#9e9e9e').text('Photo', photoX, photoY + PHOTO_H / 2 - 6, { width: PHOTO_W, align: 'center' });
    }
    doc.lineWidth(1).strokeColor('#9e9e9e').rect(photoX, photoY, PHOTO_W, PHOTO_H).stroke();

    // Details (left columns)
    detailRows.forEach((row, i) => {
        const bg = i % 2 === 0 ? '#f9f9ff' : '#ffffff';
        doc.rect(M + 8, y, detailsW, rowH).fill(bg);
        doc.lineWidth(0.3).strokeColor('#e0e0e0').moveTo(M + 8, y + rowH).lineTo(M + 8 + detailsW, y + rowH).stroke();

        doc.fontSize(8).font('Helvetica-Bold').fillColor('#1a237e');
        doc.text(`${row[0]}:`, M + 14, y + 4, { width: labelW });
        doc.font('Helvetica').fillColor('#212121');
        doc.text(row[1], M + 14 + labelW, y + 4, { width: detailsW - labelW - 10 });
        y += rowH;
    });

    y += 4;

    // ── EXAM DATE ROW ─────────────────────────────────────────────────────────
    const examDateStr = exam.startDate
        ? (exam.endDate && exam.startDate.toString() !== exam.endDate.toString()
            ? `${fmtDate(exam.startDate)} — ${fmtDate(exam.endDate)}`
            : fmtDate(exam.startDate))
        : '—';

    doc.rect(M, y, CW, 20).fill('#fff9c4');
    doc.fontSize(8.5).font('Helvetica-Bold').fillColor('#e65100');
    doc.text('Exam Date:', M + 10, y + 5, { width: 80 });
    doc.font('Helvetica-Bold').fillColor('#b71c1c');
    doc.text(examDateStr, M + 92, y + 5, { width: CW - 100 });
    y += 20;

    // ── NOTE BOX ──────────────────────────────────────────────────────────────
    doc.rect(M, y, CW, 18).fill('#e8f5e9');
    doc.lineWidth(0.5).strokeColor('#a5d6a7').rect(M, y, CW, 18).stroke();
    doc.fontSize(8).font('Helvetica-Bold').fillColor('#1b5e20');
    doc.text('★  No Entry without Admit Card. Kindly come in proper School Dress.  ★', M, y + 4, { width: CW, align: 'center' });
    y += 18;

    // ── SIGNATURE SECTION ─────────────────────────────────────────────────────
    y += 8;
    const sigCols = ['Class Teacher', 'Principal', 'Director'];
    const sigColW = CW / 3;

    sigCols.forEach((label, i) => {
        const sx = M + i * sigColW;
        doc.lineWidth(0.7).strokeColor('#555').moveTo(sx + 10, y + 26).lineTo(sx + sigColW - 10, y + 26).stroke();
        doc.font('Helvetica').fontSize(7.5).fillColor('#555555');
        doc.text(label, sx, y + 30, { width: sigColW, align: 'center' });
    });
}

export async function generateAdmitCardPDF(opts: AdmitCardPDFOptions): Promise<Buffer> {
    const { school, student } = opts;

    const doc = new PDFDocument({ size: 'A4', margin: 0, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));

    const [logoBuf, photoBuf] = await Promise.all([
        fetchImageBuffer(school.logo),
        fetchImageBuffer(student.photo),
    ]);

    // Draw card 1 (top half)
    await drawCard(doc, logoBuf, photoBuf, opts, 10);

    // Dashed cut line between cards
    const cutY = 10 + CARD_H + 4;
    doc.lineWidth(0.8).strokeColor('#9e9e9e')
        .dash(6, { space: 4 })
        .moveTo(M, cutY)
        .lineTo(M + CW, cutY)
        .stroke();
    doc.undash();
    doc.fontSize(7).fillColor('#9e9e9e').text('✂ Cut here', M, cutY + 1, { width: CW, align: 'center' });

    // Draw card 2 (bottom half — duplicate for printing)
    await drawCard(doc, logoBuf, photoBuf, opts, cutY + 10);

    doc.end();
    return new Promise<Buffer>((resolve, reject) => {
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);
    });
}
