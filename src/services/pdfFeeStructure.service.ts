// @ts-ignore - pdfkit may not have types
import PDFDocument from 'pdfkit';
import { IFeeStructure } from '../types';
import { ISchool } from '../types';
import { ISession } from '../types';
import { fetchImageBuffer } from '../utils/fetchImage';

const MARGIN = 40;
const HEADER_TOP_PADDING = 24;
const PAGE_WIDTH = 595; // A4
const CONTENT_WIDTH = PAGE_WIDTH - 2 * MARGIN;
const LOGO_SIZE = 40;

export interface FeeStructurePDFOptions {
    school: ISchool;
    session: ISession;
    structure: IFeeStructure;
    logoUrl?: string | null;
}

export async function generateFeeStructurePDF(options: FeeStructurePDFOptions): Promise<Buffer> {
    const { school, session, structure } = options;
    const doc = new PDFDocument({ size: 'A4', margin: MARGIN, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));

    const [logoBuf, stampBuf, sigBuf] = await Promise.all([
        fetchImageBuffer(school.logo),
        fetchImageBuffer((school as any).stamp),
        fetchImageBuffer((school as any).principalSignature),
    ]);

    const sessionLabel = session?.sessionYear?.replace('-', '–') || '2025-26';
    const items = (structure.components && structure.components.length > 0)
        ? structure.components
        : (structure.fees || []).map((f: any) => ({ name: f.title || f.name, amount: f.amount, type: f.type === 'one-time' ? 'one-time' : 'monthly' }));
    const total = structure.totalAmount ?? structure.totalAnnualFee ?? 0;
    const quarterly = Math.ceil(total / 4);
    const halfYearly = Math.ceil(total / 2);

    let y = HEADER_TOP_PADDING;

    // Header: Logo (left) – image or placeholder
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

    // School name (center-bold)
    doc.fontSize(18).font('Helvetica-Bold');
    const schoolName = school.schoolName || 'School Name';
    doc.text(schoolName, MARGIN, y + 4, { width: CONTENT_WIDTH, align: 'center' });
    y += LOGO_SIZE + 8;

    // Address
    const addr = [
        [school.address?.street, school.address?.city, school.address?.state, school.address?.pincode].filter(Boolean).join(', '),
        school.phone ? `Phone: ${school.phone}` : '',
        school.email ? `Email: ${school.email}` : '',
    ].filter(Boolean).join(' | ');
    doc.fontSize(10).font('Helvetica');
    doc.text(addr, MARGIN, y, { width: CONTENT_WIDTH, align: 'center' });
    y += 20;

    // Horizontal line
    doc.lineWidth(1.5).strokeColor('#374151');
    doc.moveTo(MARGIN, y).lineTo(PAGE_WIDTH - MARGIN, y).stroke();
    doc.lineWidth(1).strokeColor('#000000');
    y += 20;

    // Title: FEE STRUCTURE – SESSION 2025–26
    doc.fontSize(14).font('Helvetica-Bold');
    doc.text(`FEE STRUCTURE – SESSION ${sessionLabel}`, MARGIN, y, { width: CONTENT_WIDTH, align: 'center' });
    y += 22;

    doc.fontSize(11).font('Helvetica');
    doc.text(`Class: ${structure.class}`, MARGIN, y);
    y += 24;

    // Bordered table
    const tableTop = y;
    const rowHeight = 24;
    const col1 = 60;   // S.No
    const col2 = CONTENT_WIDTH - 120; // Fee Component
    const col3 = 100;  // Amount

    doc.font('Helvetica-Bold').fontSize(10);
    doc.rect(MARGIN, tableTop, CONTENT_WIDTH, rowHeight).fillAndStroke('#f3f4f6', '#e5e7eb');
    doc.fillColor('#000000');
    doc.text('S.No', MARGIN + 8, tableTop + 8, { width: col1 - 16 });
    doc.text('Fee Component', MARGIN + col1 + 8, tableTop + 8, { width: col2 - 16 });
    doc.text('Amount (₹)', MARGIN + col1 + col2 + 8, tableTop + 8, { width: col3 - 16 });
    y = tableTop + rowHeight;

    // Per-row annual amount: monthly → amount×12, one-time → amount
    const getAnnualAmount = (item: { amount: number; type?: string }) =>
        item.type === 'one-time' ? item.amount : item.amount * 12;

    doc.font('Helvetica').fontSize(10);
    items.forEach((item: { name: string; amount: number; type?: string }, i: number) => {
        doc.rect(MARGIN, y, CONTENT_WIDTH, rowHeight).stroke('#e5e7eb');
        doc.text(String(i + 1), MARGIN + 8, y + 8, { width: col1 - 16 });
        const typeLabel = item.type === 'one-time' ? ' (One-time)' : item.type === 'monthly' ? ' (Monthly ×12)' : '';
        doc.text(item.name + typeLabel, MARGIN + col1 + 8, y + 8, { width: col2 - 16 });
        doc.text(Number(getAnnualAmount(item)).toLocaleString('en-IN'), MARGIN + col1 + col2 + 8, y + 8, { width: col3 - 16 });
        y += rowHeight;
    });

    doc.rect(MARGIN, y, CONTENT_WIDTH, rowHeight).stroke('#e5e7eb');
    doc.font('Helvetica-Bold');
    doc.text('', MARGIN + 8, y + 8, { width: col1 - 16 });
    doc.text('TOTAL', MARGIN + col1 + 8, y + 8, { width: col2 - 16 });
    doc.text(Number(total).toLocaleString('en-IN'), MARGIN + col1 + col2 + 8, y + 8, { width: col3 - 16 });
    y += rowHeight + 20;

    // Installment details
    doc.font('Helvetica-Bold').fontSize(11);
    doc.text('Installment Details:', MARGIN, y);
    y += 18;
    doc.font('Helvetica').fontSize(10);
    doc.text(`Quarterly Option: ₹${quarterly.toLocaleString('en-IN')} x 4`, MARGIN, y);
    y += 16;
    doc.text(`Half-Yearly Option: ₹${halfYearly.toLocaleString('en-IN')} x 2`, MARGIN, y);
    y += 24;

    doc.font('Helvetica-Bold').fontSize(11);
    doc.text('Terms & Conditions:', MARGIN, y);
    y += 18;
    doc.font('Helvetica').fontSize(10);
    doc.text('• Fees once paid are non-refundable.', MARGIN, y);
    y += 14;
    doc.text('• Late fine applicable after due date.', MARGIN, y);
    y += 28;

    // Footer: Principal signature (left) and School stamp (right) – images or labels
    const footerY = y;
    if (sigBuf) {
        try {
            doc.image(sigBuf, MARGIN, footerY, { width: 80, height: 36 });
        } catch {
            doc.font('Helvetica').fontSize(10).text('Authorized Signature', MARGIN, footerY);
        }
    } else {
        doc.font('Helvetica').fontSize(10).text('Authorized Signature', MARGIN, footerY);
    }
    if (stampBuf) {
        try {
            doc.image(stampBuf, PAGE_WIDTH - MARGIN - 90, footerY, { width: 90, height: 40 });
        } catch {
            doc.font('Helvetica').fontSize(10).text('School Stamp', PAGE_WIDTH - MARGIN - 100, footerY, { width: 100, align: 'right' });
        }
    } else {
        doc.font('Helvetica').fontSize(10).text('School Stamp', PAGE_WIDTH - MARGIN - 100, footerY, { width: 100, align: 'right' });
    }
    y = footerY + 44;
    doc.fontSize(9).fillColor('#6b7280');
    doc.text('This is a computer generated document.', MARGIN, y, { width: CONTENT_WIDTH, align: 'center' });

    doc.end();
    return new Promise<Buffer>((resolve, reject) => {
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);
    });
}
