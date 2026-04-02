// @ts-ignore
import PDFDocument from 'pdfkit';
import { ISchool } from '../types';
import { fetchImageBuffer } from '../utils/fetchImage';

// Standard ID card: 85.6mm × 53.98mm → at 72dpi ≈ 243 × 153 pt
// We'll draw two cards per A4 page at a comfortable size (scaled up for clarity)
const PW = 595; // A4 width
const CARD_W = 260;
const CARD_H = 400;
const M = 14; // margin inside card

export interface IdCardPDFOptions {
    school: ISchool;
    sessionYear?: string;
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
        bloodGroup?: string;
        phone?: string;
        photo?: string;
        address?: { street?: string; city?: string; state?: string; pincode?: string };
    };
}

function fmtDate(d: Date | string | undefined): string {
    if (!d) return '—';
    const x = new Date(d);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${String(x.getDate()).padStart(2, '0')} ${months[x.getMonth()]} ${x.getFullYear()}`;
}

function formatSchoolAddress(school: ISchool): string {
    const a = school.address;
    if (!a) return '';
    return [a.street, a.city, a.state, a.pincode].filter(Boolean).join(', ');
}

function logoPlaceholder(doc: any, x: number, y: number, sz: number) {
    doc.circle(x + sz / 2, y + sz / 2, sz / 2).fill('#1a237e');
    doc.fillColor('#ffffff').fontSize(10).font('Helvetica-Bold').text('S', x + sz / 2 - 4, y + sz / 2 - 7, { width: 10 });
    doc.fillColor('#000000');
}

async function drawFrontCard(
    doc: any,
    logoBuf: Buffer | null,
    photoBuf: Buffer | null,
    principalSigBuf: Buffer | null,
    opts: IdCardPDFOptions,
    cx: number,
    cy: number
) {
    const { school, student, sessionYear } = opts;
    const x = cx;
    const y = cy;

    // Taller blue header: room for school name, session, and address
    const HEADER_BLUE_H = 74;
    const BANNER_H = 16;
    const headerBottom = y + HEADER_BLUE_H;

    // Card background with rounded corners
    doc.roundedRect(x, y, CARD_W, CARD_H, 12).lineWidth(2).strokeColor('#1a237e').stroke();

    // Top header band
    doc.save();
    doc.roundedRect(x, y, CARD_W, HEADER_BLUE_H, 12).clip();
    doc.rect(x, y, CARD_W, HEADER_BLUE_H).fill('#1a237e');
    doc.restore();

    // School logo
    const LOGO_SZ = 36;
    const logoX = x + M;
    const logoY = y + 10;
    if (logoBuf) {
        try { doc.image(logoBuf, logoX, logoY, { width: LOGO_SZ, height: LOGO_SZ }); }
        catch { logoPlaceholder(doc, logoX, logoY, LOGO_SZ); }
    } else { logoPlaceholder(doc, logoX, logoY, LOGO_SZ); }

    const textBlockX = x + M + LOGO_SZ + 8;
    const textBlockW = CARD_W - M * 2 - LOGO_SZ - 8;

    // Header text order:
    // 1) School name
    // 2) Affiliated to CBSE
    // 3) Address
    // 4) Session
    const schoolName = school.schoolName || 'School Name';
    doc.fontSize(10).font('Helvetica-Bold').fillColor('#ffffff');
    doc.text(schoolName, textBlockX, y + 7, { width: textBlockW, align: 'center' });

    const affiliationBoard = String((school as ISchool & { board?: string }).board || 'CBSE').trim();
    doc.fontSize(6.5).font('Helvetica').fillColor('#bbdefb');
    doc.text(`Affiliated to ${affiliationBoard}`, textBlockX, y + 20, { width: textBlockW, align: 'center' });

    const addrLine = formatSchoolAddress(school);
    if (addrLine) {
        doc.fontSize(5.5).font('Helvetica').fillColor('#e3f2fd');
        doc.text(addrLine, textBlockX, y + 30, { width: textBlockW, align: 'center', lineGap: 1 });
    }

    if (sessionYear) {
        doc.fontSize(7).font('Helvetica').fillColor('#bbdefb');
        doc.text(`Session: ${sessionYear}`, textBlockX, y + 44, { width: textBlockW, align: 'center' });
    }

    // "IDENTITY CARD" banner (below blue header)
    doc.rect(x, headerBottom, CARD_W, BANNER_H).fill('#c62828');
    doc.fontSize(8).font('Helvetica-Bold').fillColor('#ffffff');
    doc.text('STUDENT IDENTITY CARD', x, headerBottom + 3, { width: CARD_W, align: 'center' });

    let curY = headerBottom + BANNER_H + 8;

    // Student photo (centered)
    const PHOTO_W = 72;
    const PHOTO_H = 88;
    const photoX = x + (CARD_W - PHOTO_W) / 2;
    if (photoBuf) {
        try {
            // Photo border
            doc.rect(photoX - 2, curY - 2, PHOTO_W + 4, PHOTO_H + 4).lineWidth(1.5).strokeColor('#1a237e').stroke();
            doc.image(photoBuf, photoX, curY, { width: PHOTO_W, height: PHOTO_H });
        } catch {
            doc.rect(photoX, curY, PHOTO_W, PHOTO_H).fillAndStroke('#f0f0f0', '#cccccc');
            doc.fontSize(7).fillColor('#999').text('Photo', photoX, curY + PHOTO_H / 2 - 5, { width: PHOTO_W, align: 'center' });
        }
    } else {
        doc.rect(photoX - 2, curY - 2, PHOTO_W + 4, PHOTO_H + 4).lineWidth(1.5).strokeColor('#1a237e').stroke();
        doc.rect(photoX, curY, PHOTO_W, PHOTO_H).fill('#f5f5f5');
        doc.fontSize(7).fillColor('#999').text('Photo', photoX, curY + PHOTO_H / 2 - 5, { width: PHOTO_W, align: 'center' });
    }

    curY += PHOTO_H + 10;

    // Student name (big, centered)
    const studentName = `${student.firstName || ''} ${student.lastName || ''}`.trim() || '—';
    doc.fontSize(12).font('Helvetica-Bold').fillColor('#1a237e');
    doc.text(studentName, x + M, curY, { width: CARD_W - M * 2, align: 'center' });
    curY += 18;

    // Details grid
    const detailRows: [string, string][] = [
        ['Admission No', student.admissionNumber || '—'],
        ['Class / Section', `${student.class || '—'} / ${student.section || '—'}`],
        ['Roll No', String(student.rollNumber ?? '—')],
        ["Father's Name", student.fatherName || '—'],
        ['D.O.B', fmtDate(student.dateOfBirth)],
        ['Contact', student.phone || '—'],
    ];

    const labelW = 80;
    const valueW = CARD_W - M * 2 - labelW - 4;
    const rowH = 15;

    detailRows.forEach((row, i) => {
        const bg = i % 2 === 0 ? '#f8f9ff' : '#ffffff';
        doc.rect(x + M, curY, CARD_W - M * 2, rowH).fill(bg);

        doc.fontSize(6.5).font('Helvetica-Bold').fillColor('#555555');
        doc.text(row[0], x + M + 4, curY + 3.5, { width: labelW });
        doc.font('Helvetica').fillColor('#111111').fontSize(7);
        doc.text(row[1], x + M + labelW + 4, curY + 3.5, { width: valueW });
        curY += rowH;
    });

    // Bottom line separator
    curY += 4;
    doc.lineWidth(0.5).strokeColor('#1a237e').moveTo(x + M, curY).lineTo(x + CARD_W - M, curY).stroke();
    curY += 8;

    // Principal only (same position as previous Authorized Signatory — right side)
    const sigSlotW = 90;
    const sigRightX = x + CARD_W - M - sigSlotW;
    const SIG_IMG_W = Math.min(78, sigSlotW - 4);
    const SIG_IMG_H = 24;

    let lineY = curY + 2;
    if (principalSigBuf) {
        try {
            doc.image(principalSigBuf, sigRightX + (sigSlotW - SIG_IMG_W) / 2, curY, { width: SIG_IMG_W, height: SIG_IMG_H });
            lineY = curY + SIG_IMG_H + 3;
        } catch {
            lineY = curY + 2;
        }
    }

    doc.lineWidth(0.5).strokeColor('#888888').moveTo(sigRightX, lineY).lineTo(sigRightX + sigSlotW, lineY).stroke();
    doc.fontSize(6).font('Helvetica').fillColor('#888888');
    doc.text('Principal', sigRightX, lineY + 2, { width: sigSlotW, align: 'center' });
}

async function drawBackCard(doc: any, _logoBuf: Buffer | null, opts: IdCardPDFOptions, cx: number, cy: number) {
    const { school, student } = opts;
    const x = cx;
    const y = cy;

    doc.roundedRect(x, y, CARD_W, CARD_H, 12).lineWidth(2).strokeColor('#1a237e').stroke();

    // Header
    doc.save();
    doc.roundedRect(x, y, CARD_W, 36, 12).clip();
    doc.rect(x, y, CARD_W, 36).fill('#1a237e');
    doc.restore();
    doc.fontSize(9).font('Helvetica-Bold').fillColor('#ffffff');
    doc.text(school.schoolName || 'School', x, y + 11, { width: CARD_W, align: 'center' });

    let curY = y + 46;

    // Address section
    const addr = [school.address?.street, school.address?.city, school.address?.state, school.address?.pincode].filter(Boolean).join(', ');
    if (addr) {
        doc.fontSize(7).font('Helvetica-Bold').fillColor('#1a237e');
        doc.text('School Address:', x + M, curY, { width: CARD_W - M * 2 });
        curY += 11;
        doc.fontSize(7).font('Helvetica').fillColor('#333333');
        doc.text(addr, x + M, curY, { width: CARD_W - M * 2 });
        curY += 20;
    }

    // Contact
    if (school.phone) {
        doc.fontSize(7).font('Helvetica-Bold').fillColor('#1a237e');
        doc.text('Phone:', x + M, curY, { width: 40 });
        doc.font('Helvetica').fillColor('#333333');
        doc.text(school.phone, x + M + 40, curY, { width: CARD_W - M * 2 - 40 });
        curY += 12;
    }
    if (school.email) {
        doc.fontSize(7).font('Helvetica-Bold').fillColor('#1a237e');
        doc.text('Email:', x + M, curY, { width: 40 });
        doc.font('Helvetica').fillColor('#333333');
        doc.text(school.email, x + M + 40, curY, { width: CARD_W - M * 2 - 40 });
        curY += 12;
    }

    curY += 10;

    // Student home address
    const studentAddr = [student.address?.street, student.address?.city, student.address?.state, student.address?.pincode].filter(Boolean).join(', ');
    if (studentAddr) {
        doc.fontSize(7).font('Helvetica-Bold').fillColor('#1a237e');
        doc.text('Student Address:', x + M, curY, { width: CARD_W - M * 2 });
        curY += 11;
        doc.fontSize(7).font('Helvetica').fillColor('#333333');
        doc.text(studentAddr, x + M, curY, { width: CARD_W - M * 2 });
        curY += 20;
    }

    // Emergency contact
    if (student.phone) {
        doc.fontSize(7).font('Helvetica-Bold').fillColor('#1a237e');
        doc.text('Emergency Contact:', x + M, curY, { width: CARD_W - M * 2 });
        curY += 11;
        doc.fontSize(7).font('Helvetica').fillColor('#333333');
        doc.text(`${student.fatherName || 'Parent'}: ${student.phone}`, x + M, curY, { width: CARD_W - M * 2 });
        curY += 16;
    }

    // Important instructions — directly below the sections above (no gap to card bottom)
    curY += 8;
    const instructions = [
        '1. This card must be carried at all times.',
        '2. If found, please return to the school office.',
        '3. This card is non-transferable.',
        '4. Report loss immediately to the school.',
    ];
    const instrBoxTop = curY;
    const instrBoxH = 58;
    doc.rect(x + M, instrBoxTop, CARD_W - M * 2, instrBoxH).fill('#fff8e1');
    doc.lineWidth(0.5).strokeColor('#f9a825').rect(x + M, instrBoxTop, CARD_W - M * 2, instrBoxH).stroke();

    let iy = instrBoxTop + 5;
    doc.fontSize(6.5).font('Helvetica-Bold').fillColor('#e65100');
    doc.text('IMPORTANT INSTRUCTIONS:', x + M + 6, iy, { width: CARD_W - M * 2 - 12 });
    iy += 10;
    doc.fontSize(6).font('Helvetica').fillColor('#333333');
    instructions.forEach((line) => {
        doc.text(line, x + M + 6, iy, { width: CARD_W - M * 2 - 12 });
        iy += 9;
    });
}

export async function generateIdCardPDF(opts: IdCardPDFOptions): Promise<Buffer> {
    const { school, student } = opts;
    const doc = new PDFDocument({ size: 'A4', margin: 0, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));

    const [logoBuf, photoBuf, principalSigBuf] = await Promise.all([
        fetchImageBuffer(school.logo),
        fetchImageBuffer(student.photo),
        fetchImageBuffer((school as ISchool & { principalSignature?: string }).principalSignature),
    ]);

    const leftX = (PW / 2 - CARD_W) / 2;
    const rightX = PW / 2 + (PW / 2 - CARD_W) / 2;
    const topY = 40;

    // Front card (left)
    await drawFrontCard(doc, logoBuf, photoBuf, principalSigBuf, opts, leftX, topY);

    // Back card (right)
    await drawBackCard(doc, logoBuf, opts, rightX, topY);

    // Labels
    doc.fontSize(7).font('Helvetica').fillColor('#aaaaaa');
    doc.text('FRONT', leftX, topY + CARD_H + 6, { width: CARD_W, align: 'center' });
    doc.text('BACK', rightX, topY + CARD_H + 6, { width: CARD_W, align: 'center' });

    // Dashed cut guides
    doc.lineWidth(0.5).strokeColor('#cccccc').dash(4, { space: 3 });
    doc.rect(leftX - 4, topY - 4, CARD_W + 8, CARD_H + 8).stroke();
    doc.rect(rightX - 4, topY - 4, CARD_W + 8, CARD_H + 8).stroke();
    doc.undash();

    doc.end();
    return new Promise<Buffer>((resolve, reject) => {
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);
    });
}
