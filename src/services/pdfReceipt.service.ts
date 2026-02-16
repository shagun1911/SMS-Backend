// @ts-ignore - pdfkit may not have types
import PDFDocument from 'pdfkit';
import { numberToWords } from '../utils/numberToWords';
import { fetchImageBuffer } from '../utils/fetchImage';
import { IFeePayment } from '../types';
import { IStudent } from '../types';
import { ISchool } from '../types';

const MARGIN = 40;
const HEADER_TOP_PADDING = 24;
const PAGE_WIDTH = 595;
const CONTENT_WIDTH = PAGE_WIDTH - 2 * MARGIN;
const LOGO_SIZE = 40;

export interface ReceiptPDFOptions {
    school: ISchool;
    payment: IFeePayment;
    student: IStudent;
    totalAnnualFee: number;
    previousPaid: number;
    thisPayment: number;
    remainingDue: number;
}

function formatDate(d: Date): string {
    const x = new Date(d);
    const day = String(x.getDate()).padStart(2, '0');
    const month = String(x.getMonth() + 1).padStart(2, '0');
    const year = x.getFullYear();
    return `${day}-${month}-${year}`;
}

export async function generateReceiptPDF(options: ReceiptPDFOptions): Promise<Buffer> {
    const { school, payment, student, totalAnnualFee, previousPaid, thisPayment, remainingDue } = options;
    const doc = new PDFDocument({ size: 'A4', margin: MARGIN, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));

    const [logoBuf, stampBuf, sigBuf] = await Promise.all([
        fetchImageBuffer(school.logo),
        fetchImageBuffer((school as any).stamp),
        fetchImageBuffer((school as any).principalSignature),
    ]);

    let y = HEADER_TOP_PADDING;

    // Logo (left) – image or placeholder
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

    // School name (center, bold)
    doc.fontSize(18).font('Helvetica-Bold');
    const schoolName = school.schoolName || 'School Name';
    doc.text(schoolName, MARGIN, y + 4, { width: CONTENT_WIDTH, align: 'center' });
    y += LOGO_SIZE + 8;

    doc.fontSize(10).font('Helvetica');
    const addr = [school.address?.street, school.address?.city, school.address?.state, school.address?.pincode].filter(Boolean).join(', ');
    doc.text(addr || '—', MARGIN, y, { width: CONTENT_WIDTH, align: 'center' });
    y += 14;
    const contact = [school.phone, school.email].filter(Boolean).join(' | ');
    doc.text(contact || '—', MARGIN, y, { width: CONTENT_WIDTH, align: 'center' });
    y += 20;

    // Receipt No & Date (right)
    doc.fontSize(10).font('Helvetica');
    doc.text(`Receipt No: ${payment.receiptNumber}`, PAGE_WIDTH - MARGIN - 180, HEADER_TOP_PADDING, { width: 180, align: 'right' });
    doc.text(`Date: ${formatDate(payment.paymentDate)}`, PAGE_WIDTH - MARGIN - 180, HEADER_TOP_PADDING + 14, { width: 180, align: 'right' });

    // Horizontal line
    doc.lineWidth(1.5).strokeColor('#374151');
    doc.moveTo(MARGIN, y).lineTo(PAGE_WIDTH - MARGIN, y).stroke();
    doc.lineWidth(1).strokeColor('#000000');
    y += 22;

    doc.fontSize(16).font('Helvetica-Bold');
    doc.text('School Receipt', MARGIN, y, { width: CONTENT_WIDTH, align: 'center' });
    y += 28;

    // Student details (boxed)
    const boxTop = y;
    doc.rect(MARGIN, boxTop, CONTENT_WIDTH, 72).stroke('#e5e7eb');
    doc.font('Helvetica').fontSize(10);
    const studentName = `${(student.firstName || '')} ${(student.lastName || '')}`.trim() || '—';
    const fatherName = student.fatherName || '—';
    const admNo = student.admissionNumber || '—';
    const classSec = `${student.class || ''} ${student.section || ''}`.trim() || '—';
    doc.text(`Student Name: ${studentName}`, MARGIN + 12, boxTop + 12);
    doc.text(`Father Name: ${fatherName}`, MARGIN + 12, boxTop + 28);
    doc.text(`Admission No: ${admNo}`, MARGIN + 12, boxTop + 44);
    doc.text(`Class: ${classSec}`, MARGIN + 12, boxTop + 60);
    y = boxTop + 72 + 20;

    // Payment details table
    doc.font('Helvetica-Bold').fontSize(12);
    doc.text('Payment Details', MARGIN, y);
    y += 22;

    const rowH = 28;
    const labelW = 200;
    const amountW = 120;

    const rows = [
        { label: 'Total Annual Fee', value: totalAnnualFee, bold: false },
        { label: 'Previously Paid', value: previousPaid, bold: false },
        { label: 'This Payment', value: thisPayment, bold: true },
        { label: 'Remaining Balance', value: remainingDue, bold: true },
    ];

    rows.forEach((r) => {
        doc.rect(MARGIN, y, CONTENT_WIDTH, rowH).fillAndStroke(r.bold ? '#fef3c7' : '#ffffff', '#e5e7eb');
        doc.fillColor('#000000');
        if (r.bold) doc.font('Helvetica-Bold');
        else doc.font('Helvetica');
        doc.fontSize(10);
        doc.text(r.label, MARGIN + 12, y + 8, { width: labelW });
        doc.text(`₹${Number(r.value).toLocaleString('en-IN')}`, MARGIN + CONTENT_WIDTH - amountW - 12, y + 8, { width: amountW, align: 'right' });
        y += rowH;
    });
    y += 16;

    // Amount in words
    doc.font('Helvetica').fontSize(10);
    doc.text('Amount in Words:', MARGIN, y);
    y += 14;
    doc.font('Helvetica-Bold');
    doc.text(numberToWords(thisPayment), MARGIN, y);
    y += 28;

    // Footer: Principal signature (left), Stamp (right)
    const footerY = y;
    doc.font('Helvetica').fontSize(10).text(`Payment Mode: ${(payment.paymentMode || 'Cash').toUpperCase()}`, MARGIN, footerY);
    if (sigBuf) {
        try {
            doc.image(sigBuf, PAGE_WIDTH - MARGIN - 120, footerY - 8, { width: 80, height: 36 });
        } catch {
            doc.text('Authorized Signatory', PAGE_WIDTH - MARGIN - 120, footerY, { width: 120, align: 'right' });
        }
    } else {
        doc.text('Authorized Signatory', PAGE_WIDTH - MARGIN - 120, footerY, { width: 120, align: 'right' });
    }
    y = footerY + 20;
    if (stampBuf) {
        try {
            doc.image(stampBuf, PAGE_WIDTH - MARGIN - 90, y, { width: 90, height: 40 });
        } catch {
            doc.rect(PAGE_WIDTH - MARGIN - 80, y, 80, 40).stroke('#d1d5db');
            doc.fontSize(9).fillColor('#6b7280').text('Stamp', PAGE_WIDTH - MARGIN - 80, y + 14, { width: 80, align: 'center' });
        }
    } else {
        doc.rect(PAGE_WIDTH - MARGIN - 80, y, 80, 40).stroke('#d1d5db');
        doc.fontSize(9).fillColor('#6b7280').text('Stamp', PAGE_WIDTH - MARGIN - 80, y + 14, { width: 80, align: 'center' });
    }
    y += 52;
    doc.fillColor('#000000');
    doc.font('Helvetica').fontSize(10);
    doc.text('Thank you for your payment.', MARGIN, y, { width: CONTENT_WIDTH, align: 'center' });

    doc.end();
    return new Promise<Buffer>((resolve, reject) => {
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);
    });
}
