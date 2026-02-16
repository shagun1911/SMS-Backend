// @ts-ignore - pdfkit may not have types
import PDFDocument from 'pdfkit';
import { ISchool } from '../types';
import { fetchImageBuffer } from '../utils/fetchImage';

const MARGIN = 40;
const HEADER_TOP_PADDING = 24;
const PAGE_WIDTH = 595;
const CONTENT_WIDTH = PAGE_WIDTH - 2 * MARGIN;
const LOGO_SIZE = 40;

export interface AdmitCardPDFOptions {
    school: ISchool;
    exam: { title: string; startDate?: Date; endDate?: Date; type?: string };
    student: {
        firstName?: string;
        lastName?: string;
        admissionNumber?: string;
        class?: string;
        section?: string;
        rollNumber?: string | number;
        fatherName?: string;
        photo?: string;
    };
}

function formatDate(d: Date | string | undefined): string {
    if (!d) return '—';
    const x = new Date(d);
    return x.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export async function generateAdmitCardPDF(options: AdmitCardPDFOptions): Promise<Buffer> {
    const { school, exam, student } = options;
    const doc = new PDFDocument({ size: 'A4', margin: MARGIN, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));

    const [logoBuf, stampBuf, sigBuf, photoBuf] = await Promise.all([
        fetchImageBuffer(school.logo),
        fetchImageBuffer((school as any).stamp),
        fetchImageBuffer((school as any).principalSignature),
        fetchImageBuffer(student.photo),
    ]);

    let y = HEADER_TOP_PADDING;

    // Logo (left)
    if (logoBuf) {
        try {
            doc.image(logoBuf, MARGIN, y, { width: LOGO_SIZE, height: LOGO_SIZE });
        } catch {
            doc.rect(MARGIN, y, LOGO_SIZE, LOGO_SIZE).fill('#374151');
            doc.fillColor('#ffffff').fontSize(14).font('Helvetica-Bold').text('S', MARGIN + 12, y + 12, { width: 20 });
            doc.fillColor('#000000');
        }
    } else {
        doc.rect(MARGIN, y, LOGO_SIZE, LOGO_SIZE).fill('#374151');
        doc.fillColor('#ffffff').fontSize(14).font('Helvetica-Bold').text('S', MARGIN + 12, y + 12, { width: 20 });
        doc.fillColor('#000000');
    }

    doc.fontSize(18).font('Helvetica-Bold');
    const schoolName = school.schoolName || 'School Name';
    doc.text(schoolName, MARGIN, y + 4, { width: CONTENT_WIDTH, align: 'center' });
    y += LOGO_SIZE + 10;

    doc.fontSize(10).font('Helvetica');
    const addr = [school.address?.street, school.address?.city, school.address?.state, school.address?.pincode].filter(Boolean).join(', ');
    doc.text(addr || '—', MARGIN, y, { width: CONTENT_WIDTH, align: 'center' });
    y += 16;

    doc.lineWidth(1.5).strokeColor('#374151');
    doc.moveTo(MARGIN, y).lineTo(PAGE_WIDTH - MARGIN, y).stroke();
    doc.lineWidth(1).strokeColor('#000000');
    y += 24;

    // Title: Admit Card
    doc.fontSize(14).font('Helvetica-Bold');
    doc.text('ADMIT CARD', MARGIN, y, { width: CONTENT_WIDTH, align: 'center' });
    y += 22;

    doc.fontSize(11).font('Helvetica');
    const examTitle = exam.title || 'Exam';
    const examDate = exam.startDate ? formatDate(exam.startDate) : '—';
    doc.text(`${examTitle} • ${examDate}`, MARGIN, y, { width: CONTENT_WIDTH, align: 'center' });
    y += 28;

    // Card box
    const boxLeft = MARGIN;
    const boxWidth = CONTENT_WIDTH - 100; // leave space for photo
    const photoLeft = boxLeft + boxWidth + 12;
    const photoW = 80;
    const photoH = 100;

    doc.rect(boxLeft, y, CONTENT_WIDTH, 130).stroke('#e5e7eb');
    const rowH = 22;
    const labelW = 140;

    const rows = [
        ['Name:', `${(student.firstName || '')} ${(student.lastName || '')}`.trim() || '—'],
        ['Admission No:', student.admissionNumber || '—'],
        ['Class / Section:', `${student.class || '—'} - ${student.section || '—'}`],
        ['Roll No:', String(student.rollNumber ?? '—')],
        ['Father:', student.fatherName || '—'],
    ];

    doc.font('Helvetica').fontSize(10);
    rows.forEach(([label, value], i) => {
        doc.fillColor('#374151').text(label, boxLeft + 12, y + 8 + i * rowH, { width: labelW });
        doc.fillColor('#000000').text(value, boxLeft + 12 + labelW, y + 8 + i * rowH, { width: boxWidth - labelW - 24 });
    });

    // Photo (right side of box)
    if (photoBuf) {
        try {
            doc.image(photoBuf, photoLeft, y + 14, { width: photoW, height: photoH });
        } catch {
            doc.rect(photoLeft, y + 14, photoW, photoH).fillAndStroke('#f3f4f6', '#d1d5db');
            doc.fillColor('#9ca3af').fontSize(9).text('Photo', photoLeft, y + 14 + photoH / 2 - 8, { width: photoW, align: 'center' });
        }
    } else {
        doc.rect(photoLeft, y + 14, photoW, photoH).fillAndStroke('#f3f4f6', '#d1d5db');
        doc.fillColor('#9ca3af').fontSize(9).text('Photo', photoLeft, y + 14 + photoH / 2 - 8, { width: photoW, align: 'center' });
    }
    doc.fillColor('#000000');
    y += 130 + 24;

    // Footer: signature and stamp
    const footerY = y;
    if (sigBuf) {
        try {
            doc.image(sigBuf, MARGIN, footerY, { width: 80, height: 36 });
        } catch {
            doc.font('Helvetica').fontSize(10).text('Principal / Authorized', MARGIN, footerY);
        }
    } else {
        doc.font('Helvetica').fontSize(10).text('Principal / Authorized', MARGIN, footerY);
    }
    if (stampBuf) {
        try {
            doc.image(stampBuf, PAGE_WIDTH - MARGIN - 90, footerY, { width: 90, height: 40 });
        } catch {
            doc.font('Helvetica').fontSize(10).text('School Stamp', PAGE_WIDTH - MARGIN - 90, footerY, { width: 90, align: 'right' });
        }
    } else {
        doc.font('Helvetica').fontSize(10).text('School Stamp', PAGE_WIDTH - MARGIN - 90, footerY, { width: 90, align: 'right' });
    }
    y += 48;
    doc.fontSize(9).fillColor('#6b7280');
    doc.text('This is a computer generated admit card.', MARGIN, y, { width: CONTENT_WIDTH, align: 'center' });

    doc.end();
    return new Promise<Buffer>((resolve, reject) => {
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);
    });
}
