// @ts-ignore - pdfkit may not have types
import PDFDocument from 'pdfkit';
import { IFeeStructure, ISchool, ISession } from '../types';
import { fetchImageBuffer } from '../utils/fetchImage';

const M = 28;
const PW = 595;
const CW = PW - 2 * M;

export interface FeeStructurePDFOptions {
    school: ISchool;
    session: ISession;
    structure: IFeeStructure;
    logoUrl?: string | null;
}

function money(n: number): string {
    return Number(n || 0).toLocaleString('en-IN');
}

function logoPlaceholder(doc: any, x: number, y: number, sz: number) {
    doc.circle(x + sz / 2, y + sz / 2, sz / 2).fill('#1a237e');
    doc.fillColor('#ffffff').fontSize(18).font('Helvetica-Bold').text('S', x + sz / 2 - 6, y + sz / 2 - 10, { width: 14 });
    doc.fillColor('#000000');
}

function hLine(doc: any, y: number, color = '#bdbdbd', lw = 0.5) {
    doc.lineWidth(lw).strokeColor(color).moveTo(M, y).lineTo(M + CW, y).stroke();
}

export async function generateFeeStructurePDF(opts: FeeStructurePDFOptions): Promise<Buffer> {
    const { school, session, structure } = opts;

    const doc = new PDFDocument({ size: 'A4', margin: 0, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));

    const [logoBuf, stampBuf, sigBuf] = await Promise.all([
        fetchImageBuffer(school.logo),
        fetchImageBuffer((school as any).stamp),
        fetchImageBuffer((school as any).principalSignature),
    ]);

    const sessionLabel = session?.sessionYear || '—';
    const items = (structure.components && structure.components.length > 0)
        ? structure.components
        : (structure.fees || []).map((f: any) => ({
            name: f.title || f.name,
            amount: f.amount,
            type: f.type === 'one-time' ? 'one-time' : 'monthly',
        }));

    const getAnnual = (item: { amount: number; type?: string }) =>
        item.type === 'one-time' ? item.amount : item.amount * 12;

    const totalAnnual = structure.totalAmount ?? structure.totalAnnualFee
        ?? items.reduce((s: number, i: { amount: number; type?: string }) => s + getAnnual(i), 0);

    const quarterly = Math.ceil(totalAnnual / 4);
    const halfYearly = Math.ceil(totalAnnual / 2);
    const monthly = Math.ceil(totalAnnual / 12);

    // ── OUTER BORDER ──────────────────────────────────────────────────────────
    doc.rect(8, 8, PW - 16, 826).lineWidth(2).strokeColor('#1a237e').stroke();
    doc.rect(11, 11, PW - 22, 820).lineWidth(0.5).strokeColor('#9fa8da').stroke();

    let y = 22;

    // ── LOGO + SCHOOL HEADER ──────────────────────────────────────────────────
    const LOGO_SZ = 64;
    if (logoBuf) {
        try { doc.image(logoBuf, M, y, { width: LOGO_SZ, height: LOGO_SZ }); }
        catch { logoPlaceholder(doc, M, y, LOGO_SZ); }
    } else { logoPlaceholder(doc, M, y, LOGO_SZ); }

    const schoolName = school.schoolName || 'School Name';
    const board = (school as any).board ? `Affiliated to ${(school as any).board}` : '';
    const addr = [school.address?.street, school.address?.city, school.address?.state, school.address?.pincode].filter(Boolean).join(', ');
    const contact = [school.phone ? `Ph: ${school.phone}` : '', school.email || ''].filter(Boolean).join('   |   ');

    doc.fontSize(19).font('Helvetica-Bold').fillColor('#1a237e');
    doc.text(schoolName, M + LOGO_SZ + 8, y + 4, { width: CW - LOGO_SZ - 8, align: 'center' });

    if (board) {
        doc.fontSize(8).font('Helvetica').fillColor('#c62828');
        doc.text(board, M + LOGO_SZ + 8, y + 28, { width: CW - LOGO_SZ - 8, align: 'center' });
    }
    doc.fontSize(8.5).font('Helvetica').fillColor('#424242');
    doc.text(addr || '—', M + LOGO_SZ + 8, y + (board ? 40 : 30), { width: CW - LOGO_SZ - 8, align: 'center' });
    doc.text(contact || '—', M + LOGO_SZ + 8, y + (board ? 52 : 42), { width: CW - LOGO_SZ - 8, align: 'center' });

    y += LOGO_SZ + 12;
    hLine(doc, y, '#1a237e', 1.5);
    y += 2;

    // ── TITLE BAR ──────────────────────────────────────────────────────────────
    doc.rect(M, y, CW, 22).fill('#1a237e');
    doc.fontSize(12).font('Helvetica-Bold').fillColor('#ffffff');
    doc.text('FEE STRUCTURE', M, y + 5, { width: CW, align: 'center' });
    y += 22;

    // ── SESSION + CLASS BANNER ────────────────────────────────────────────────
    doc.rect(M, y, CW, 20).fill('#e8eaf6');
    doc.fontSize(9).font('Helvetica-Bold').fillColor('#1a237e');
    doc.text(`Session: ${sessionLabel}`, M + 8, y + 5, { width: CW / 2 - 16 });
    doc.text(`Class: ${structure.class || '—'}`, M + CW / 2, y + 5, { width: CW / 2 - 8, align: 'right' });
    hLine(doc, y + 20, '#9fa8da', 0.5);
    y += 20;

    // ── FEE MONTHS LABEL ─────────────────────────────────────────────────────
    doc.rect(M, y, CW, 18).fill('#fff9c4');
    doc.fontSize(8).font('Helvetica-Bold').fillColor('#e65100');
    doc.text('Due Months:', M + 8, y + 4, { width: 75 });
    doc.font('Helvetica').fillColor('#333333');
    doc.text('Apr, May, Jun, Jul, Aug, Sep, Oct, Nov, Dec, Jan, Feb, Mar  (12 Months)', M + 86, y + 4, { width: CW - 100 });
    hLine(doc, y + 18, '#9fa8da', 0.5);
    y += 18;

    // ── FEE TABLE ─────────────────────────────────────────────────────────────
    y += 6;

    const colSNo = 34;
    const colType = 90;
    const colAmt = 90;
    const colMonthly = 90;
    const colName = CW - colSNo - colType - colAmt - colMonthly;

    // Header
    doc.rect(M, y, CW, 22).fill('#37474f');
    doc.fontSize(8.5).font('Helvetica-Bold').fillColor('#ffffff');
    doc.text('S.No', M + 6, y + 6, { width: colSNo - 8, align: 'center' });
    doc.text('Fee Component', M + colSNo + 6, y + 6, { width: colName - 8 });
    doc.text('Type', M + colSNo + colName + 6, y + 6, { width: colType - 8, align: 'center' });
    doc.text('Per Month (₹)', M + colSNo + colName + colType + 4, y + 6, { width: colMonthly - 8, align: 'right' });
    doc.text('Annual (₹)', M + colSNo + colName + colType + colMonthly + 4, y + 6, { width: colAmt - 10, align: 'right' });
    y += 22;

    doc.fontSize(8.5);
    let totalRows = 0;
    items.forEach((item: { name: string; amount: number; type?: string }, i: number) => {
        const annualAmt = getAnnual(item);
        const monthlyAmt = item.type === 'one-time' ? 0 : item.amount;
        const bg = i % 2 === 0 ? '#ffffff' : '#f5f6fa';
        const h = 18;

        doc.rect(M, y, CW, h).fill(bg);
        // vertical lines
        doc.lineWidth(0.3).strokeColor('#e0e0e0')
            .moveTo(M + colSNo, y).lineTo(M + colSNo, y + h).stroke()
            .moveTo(M + colSNo + colName, y).lineTo(M + colSNo + colName, y + h).stroke()
            .moveTo(M + colSNo + colName + colType, y).lineTo(M + colSNo + colName + colType, y + h).stroke()
            .moveTo(M + colSNo + colName + colType + colMonthly, y).lineTo(M + colSNo + colName + colType + colMonthly, y + h).stroke();
        hLine(doc, y + h, '#e8e8e8', 0.3);

        doc.font('Helvetica').fillColor('#212121');
        doc.text(String(i + 1), M + 6, y + 4, { width: colSNo - 8, align: 'center' });
        doc.text(item.name, M + colSNo + 6, y + 4, { width: colName - 8 });

        const typeLabel = item.type === 'one-time' ? 'One-time' : 'Monthly';
        const typeColor = item.type === 'one-time' ? '#e65100' : '#1565c0';
        doc.fillColor(typeColor).text(typeLabel, M + colSNo + colName + 6, y + 4, { width: colType - 8, align: 'center' });

        doc.fillColor('#212121');
        doc.text(item.type === 'one-time' ? '—' : money(monthlyAmt), M + colSNo + colName + colType + 4, y + 4, { width: colMonthly - 8, align: 'right' });
        doc.text(money(annualAmt), M + colSNo + colName + colType + colMonthly + 4, y + 4, { width: colAmt - 10, align: 'right' });

        y += h;
        totalRows++;
    });

    // Total Row
    doc.rect(M, y, CW, 22).fill('#1a237e');
    doc.fontSize(9).font('Helvetica-Bold').fillColor('#ffffff');
    doc.text('TOTAL ANNUAL FEE', M + colSNo + 6, y + 6, { width: colName + colType + colMonthly - 8 });
    doc.text(`₹ ${money(totalAnnual)}`, M + colSNo + colName + colType + colMonthly + 4, y + 6, { width: colAmt - 10, align: 'right' });
    y += 22;

    y += 12;

    // ── PAYMENT SCHEDULE ──────────────────────────────────────────────────────
    doc.fontSize(10).font('Helvetica-Bold').fillColor('#1a237e');
    doc.text('Payment Schedule Options', M, y);
    y += 4;
    hLine(doc, y, '#9fa8da', 0.8);
    y += 10;

    const schedRows = [
        { label: 'Monthly', value: monthly, note: 'per month × 12' },
        { label: 'Quarterly', value: quarterly, note: 'per quarter × 4' },
        { label: 'Half-Yearly', value: halfYearly, note: 'per installment × 2' },
        { label: 'Yearly (Full)', value: totalAnnual, note: 'lump sum — full year' },
    ];

    const schedColW = CW / 4;
    schedRows.forEach((s, i) => {
        const sx = M + i * schedColW;
        doc.rect(sx, y, schedColW - 4, 52).fillAndStroke(i % 2 === 0 ? '#e3f2fd' : '#e8f5e9', '#90caf9');
        doc.fontSize(8.5).font('Helvetica-Bold').fillColor('#1a237e');
        doc.text(s.label, sx + 6, y + 8, { width: schedColW - 16, align: 'center' });
        doc.fontSize(13).font('Helvetica-Bold').fillColor('#1565c0');
        doc.text(`₹${money(s.value)}`, sx + 4, y + 22, { width: schedColW - 12, align: 'center' });
        doc.fontSize(7.5).font('Helvetica').fillColor('#546e7a');
        doc.text(s.note, sx + 4, y + 40, { width: schedColW - 12, align: 'center' });
    });
    y += 60;

    // ── TERMS & CONDITIONS ────────────────────────────────────────────────────
    doc.fontSize(9).font('Helvetica-Bold').fillColor('#1a237e');
    doc.text('Terms & Conditions', M, y);
    y += 4;
    hLine(doc, y, '#9fa8da', 0.6);
    y += 8;

    const terms = [
        'Fees once paid are non-refundable under any circumstances.',
        'A late fine will be applicable after the due date (15th of every month).',
        'Fee must be paid by cash, cheque or online transfer as per school policy.',
        'Cheques should be drawn in favor of the school name.',
        'For any fee-related queries, contact the accounts office.',
    ];

    doc.fontSize(8.5).font('Helvetica').fillColor('#424242');
    terms.forEach(term => {
        doc.text(`•  ${term}`, M + 8, y, { width: CW - 16 });
        y += 14;
    });

    y += 8;

    // ── FOOTER ────────────────────────────────────────────────────────────────
    hLine(doc, y, '#9fa8da', 0.6);
    y += 10;

    if (sigBuf) {
        try { doc.image(sigBuf, M + 10, y, { width: 90, height: 38 }); }
        catch {}
    }
    doc.lineWidth(0.7).strokeColor('#555').moveTo(M + 10, y + 42).lineTo(M + 130, y + 42).stroke();
    doc.font('Helvetica').fontSize(7.5).fillColor('#555').text('Authorized Signatory / Principal', M + 10, y + 44, { width: 120, align: 'center' });

    if (stampBuf) {
        try { doc.image(stampBuf, PW - M - 110, y, { width: 90, height: 38 }); }
        catch {}
    }
    doc.lineWidth(0.7).strokeColor('#555').moveTo(PW - M - 120, y + 42).lineTo(PW - M - 10, y + 42).stroke();
    doc.font('Helvetica').fontSize(7.5).fillColor('#555').text('School Stamp & Seal', PW - M - 120, y + 44, { width: 110, align: 'center' });

    y += 60;
    doc.font('Helvetica').fontSize(7).fillColor('#9e9e9e');
    doc.text('★  This is a computer generated document.  ★', M, y, { width: CW, align: 'center' });

    doc.end();
    return new Promise<Buffer>((resolve, reject) => {
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);
    });
}
