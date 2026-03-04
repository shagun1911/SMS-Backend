// @ts-ignore - pdfkit may not have types
import PDFDocument from 'pdfkit';
import { numberToWords } from '../utils/numberToWords';
import { fetchImageBuffer } from '../utils/fetchImage';
import { IFeePayment, IStudent, ISchool } from '../types';

const M = 28;
const PW = 595;
const CW = PW - 2 * M;

export interface ReceiptPDFOptions {
    school: ISchool;
    payment: IFeePayment;
    student: IStudent;
    totalAnnualFee: number;
    previousPaid: number;
    thisPayment: number;
    remainingDue: number;
    sessionYear?: string;
    feeComponents?: Array<{ name: string; amount: number }>;
    concession?: number;
    lateFee?: number;
}

function fmtDate(d: Date | string): string {
    const x = new Date(d);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${String(x.getDate()).padStart(2, '0')} ${months[x.getMonth()]} ${x.getFullYear()}`;
}

function money(n: number): string {
    return Number(n || 0).toLocaleString('en-IN');
}

function logoPlaceholder(doc: any, x: number, y: number, sz: number) {
    doc.circle(x + sz / 2, y + sz / 2, sz / 2).fill('#1a237e');
    doc.fillColor('#ffffff').fontSize(16).font('Helvetica-Bold');
    doc.text('S', x + sz / 2 - 6, y + sz / 2 - 10, { width: 14 });
    doc.fillColor('#000000');
}

function hLine(doc: any, y: number, color = '#bdbdbd', lw = 0.5) {
    doc.lineWidth(lw).strokeColor(color).moveTo(M, y).lineTo(M + CW, y).stroke();
}

export async function generateReceiptPDF(opts: ReceiptPDFOptions): Promise<Buffer> {
    const {
        school, payment, student,
        totalAnnualFee, thisPayment, remainingDue, previousPaid = 0,
        sessionYear, feeComponents, concession = 0, lateFee = 0,
    } = opts;

    const doc = new PDFDocument({ size: 'A4', margin: 0, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));

    const [logoBuf, stampBuf, sigBuf] = await Promise.all([
        fetchImageBuffer(school.logo),
        fetchImageBuffer((school as any).stamp),
        fetchImageBuffer((school as any).principalSignature),
    ]);

    // ── OUTER BORDER ──────────────────────────────────────────────────────────
    doc.rect(8, 8, PW - 16, 826).lineWidth(2).strokeColor('#1a237e').stroke();
    doc.rect(11, 11, PW - 22, 820).lineWidth(0.5).strokeColor('#9fa8da').stroke();

    // ── HEADER ────────────────────────────────────────────────────────────────
    let y = 22;
    const LOGO_SZ = 64;

    if (logoBuf) {
        try { doc.image(logoBuf, M, y, { width: LOGO_SZ, height: LOGO_SZ }); }
        catch { logoPlaceholder(doc, M, y, LOGO_SZ); }
    } else { logoPlaceholder(doc, M, y, LOGO_SZ); }

    const schoolName = school.schoolName || 'School Name';
    const board = (school as any).board ? `Affiliated to ${(school as any).board} | Board` : '';
    const addr = [school.address?.street, school.address?.city, school.address?.state, school.address?.pincode].filter(Boolean).join(', ');
    const contact = [school.phone, school.email].filter(Boolean).join('   |   ');

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
    doc.text('FEE RECEIPT', M, y + 5, { width: CW, align: 'center' });
    y += 22;

    // ── INFO STRIP (Receipt No | Date | Session) ──────────────────────────────
    doc.rect(M, y, CW, 20).fill('#e8eaf6');
    doc.fontSize(8.5).font('Helvetica-Bold').fillColor('#1a237e');
    const rn = `Receipt No: ${payment.receiptNumber}`;
    const dt = `Date: ${fmtDate(payment.paymentDate)}`;
    const sess = `Session: ${sessionYear || '—'}`;
    doc.text(rn, M + 8, y + 5, { width: CW / 3, align: 'left' });
    doc.text(dt, M + CW / 3, y + 5, { width: CW / 3, align: 'center' });
    doc.text(sess, M + (2 * CW) / 3, y + 5, { width: CW / 3 - 8, align: 'right' });
    hLine(doc, y, '#c5cae9', 0.5);
    hLine(doc, y + 20, '#9fa8da', 0.5);
    y += 20;

    // ── STUDENT DETAILS ───────────────────────────────────────────────────────
    const studentName = `${student.firstName || ''} ${student.lastName || ''}`.trim();
    const motherName = (student as any).motherName || '';
    const phone = (student as any).phone || '';
    const rollNo = (student as any).rollNumber || '—';

    const detailRows: [string, string, string, string][] = [
        ['Name', studentName || '—', 'SID', student.admissionNumber || '—'],
        ["Father's Name", student.fatherName || '—', 'Mobile', phone || '—'],
        ["Mother's Name", motherName || '—', 'Class / Section', `${student.class || '—'} - ${student.section || '—'}`],
        ['Roll No', String(rollNo), 'Fee Month', sessionYear ? 'Apr–Mar (12 Months)' : '—'],
    ];

    const rowH = 18;
    const halfW = CW / 2;
    const lw = 60; // label column width

    detailRows.forEach((row, i) => {
        const bg = i % 2 === 0 ? '#fafafa' : '#f5f5f5';
        doc.rect(M, y, CW, rowH).fill(bg);
        hLine(doc, y + rowH, '#e0e0e0', 0.4);
        doc.lineWidth(0.4).strokeColor('#e0e0e0').moveTo(M + halfW, y).lineTo(M + halfW, y + rowH).stroke();

        doc.fontSize(8).font('Helvetica-Bold').fillColor('#1a237e');
        doc.text(`${row[0]}:`, M + 6, y + 4, { width: lw });
        doc.font('Helvetica').fillColor('#212121');
        doc.text(row[1], M + lw + 4, y + 4, { width: halfW - lw - 10 });

        doc.font('Helvetica-Bold').fillColor('#1a237e');
        doc.text(`${row[2]}:`, M + halfW + 6, y + 4, { width: lw });
        doc.font('Helvetica').fillColor('#212121');
        doc.text(row[3], M + halfW + lw + 4, y + 4, { width: halfW - lw - 10 });

        y += rowH;
    });

    hLine(doc, y, '#9fa8da', 0.8);
    y += 4;

    // ── FEE TABLE ─────────────────────────────────────────────────────────────
    const colSNo = 32;
    const colAmt = 80;
    const colPart = CW - colSNo - colAmt;

    // Table header
    doc.rect(M, y, CW, 20).fill('#37474f');
    doc.fontSize(8.5).font('Helvetica-Bold').fillColor('#ffffff');
    doc.text('S.No', M + 6, y + 5, { width: colSNo - 8 });
    doc.text('PARTICULARS', M + colSNo + 6, y + 5, { width: colPart - 12 });
    doc.text('AMOUNT (₹)', M + colSNo + colPart + 4, y + 5, { width: colAmt - 10, align: 'right' });
    y += 20;

    const components = feeComponents && feeComponents.length > 0
        ? feeComponents
        : [{ name: 'Fee Payment', amount: thisPayment }];

    doc.fillColor('#212121').fontSize(8.5);
    components.forEach((item, i) => {
        const bg = i % 2 === 0 ? '#ffffff' : '#f9f9f9';
        const h = 17;
        doc.rect(M, y, CW, h).fill(bg);
        doc.lineWidth(0.3).strokeColor('#e0e0e0')
            .moveTo(M, y + h).lineTo(M + CW, y + h).stroke()
            .moveTo(M + colSNo, y).lineTo(M + colSNo, y + h).stroke()
            .moveTo(M + colSNo + colPart, y).lineTo(M + colSNo + colPart, y + h).stroke();
        doc.font('Helvetica').fillColor('#212121');
        doc.text(String(i + 1), M + 6, y + 4, { width: colSNo - 8, align: 'center' });
        doc.text(item.name, M + colSNo + 6, y + 4, { width: colPart - 12 });
        doc.text(money(item.amount), M + colSNo + colPart + 4, y + 4, { width: colAmt - 10, align: 'right' });
        y += h;
    });

    // ── SUMMARY ROWS ──────────────────────────────────────────────────────────
    hLine(doc, y, '#546e7a', 1);
    y += 1;

    const netFee = totalAnnualFee + lateFee - concession;
    const balance = remainingDue;

    const sumRows: { label: string; value: number; fg: string; bg: string; bold: boolean }[] = [
        { label: 'Total Fee', value: totalAnnualFee, fg: '#212121', bg: '#eceff1', bold: false },
        { label: '(+) Old Balance', value: payment.previousDue > thisPayment + remainingDue ? payment.previousDue - thisPayment - remainingDue : 0, fg: '#b71c1c', bg: '#ffebee', bold: false },
        { label: '(+) Additional / Late Fee', value: lateFee, fg: '#e65100', bg: '#fff3e0', bold: false },
        { label: '(-) Concession / Discount', value: concession, fg: '#1b5e20', bg: '#f1f8e9', bold: false },
        { label: 'NET FEE', value: netFee, fg: '#ffffff', bg: '#1565c0', bold: true },
        ...(previousPaid > 0 ? [{ label: '(+) Paid at Admission', value: previousPaid, fg: '#1b5e20', bg: '#e8f5e9', bold: false }] : []),
        { label: previousPaid > 0 ? 'AMOUNT RECEIVED (This Payment)' : 'AMOUNT RECEIVED', value: thisPayment, fg: '#ffffff', bg: '#2e7d32', bold: true },
        ...(previousPaid > 0 ? [{ label: 'TOTAL PAID TO DATE', value: previousPaid + thisPayment, fg: '#ffffff', bg: '#1b5e20', bold: true }] : []),
        { label: 'BALANCE DUE', value: balance, fg: '#ffffff', bg: balance > 0 ? '#b71c1c' : '#388e3c', bold: true },
    ];

    const sumH = 18;
    sumRows.forEach(row => {
        doc.rect(M, y, CW, sumH).fill(row.bg);
        doc.lineWidth(0.3).strokeColor('#9e9e9e').moveTo(M, y + sumH).lineTo(M + CW, y + sumH).stroke();
        doc.lineWidth(0.3).strokeColor('#9e9e9e').moveTo(M + colSNo, y).lineTo(M + colSNo, y + sumH).stroke();
        doc.lineWidth(0.3).strokeColor('#9e9e9e').moveTo(M + colSNo + colPart, y).lineTo(M + colSNo + colPart, y + sumH).stroke();

        if (row.bold) doc.font('Helvetica-Bold'); else doc.font('Helvetica');
        doc.fontSize(8.5).fillColor(row.fg);
        doc.text(row.label, M + colSNo + 6, y + 4, { width: colPart - 12 });
        doc.text(money(row.value), M + colSNo + colPart + 4, y + 4, { width: colAmt - 10, align: 'right' });
        y += sumH;
    });

    hLine(doc, y, '#9fa8da', 0.8);
    y += 8;

    // ── PAYMENT INFO ──────────────────────────────────────────────────────────
    doc.rect(M, y, CW, 50).fillAndStroke('#f5f5f5', '#c5cae9');
    const pInfoY = y + 8;
    doc.fontSize(8).font('Helvetica-Bold').fillColor('#1a237e').text('Payment Mode:', M + 8, pInfoY, { width: 90 });
    doc.font('Helvetica').fillColor('#212121').text((payment.paymentMode || 'Cash').toUpperCase(), M + 100, pInfoY, { width: 100 });
    doc.font('Helvetica-Bold').fillColor('#1a237e').text('Total Paid Amount:', M + 220, pInfoY, { width: 105 });
    doc.font('Helvetica').fillColor('#212121').text(`₹${money(thisPayment)}`, M + 330, pInfoY, { width: CW - 340 });

    doc.font('Helvetica-Bold').fillColor('#1a237e').text('Amount in Word:', M + 8, pInfoY + 14, { width: 95 });
    doc.font('Helvetica').fillColor('#212121').text(numberToWords(thisPayment), M + 106, pInfoY + 14, { width: CW - 120 });

    doc.font('Helvetica-Bold').fillColor('#1a237e').text('Received By:', M + 8, pInfoY + 28, { width: 80 });
    doc.lineWidth(0.7).strokeColor('#9e9e9e').moveTo(M + 90, pInfoY + 36).lineTo(M + 250, pInfoY + 36).stroke();

    y += 50 + 8;

    // ── FOOTER ────────────────────────────────────────────────────────────────
    hLine(doc, y, '#9fa8da', 0.5);
    y += 10;

    // Principal signature (left)
    const sigX = M + 20;
    if (sigBuf) {
        try { doc.image(sigBuf, sigX, y, { width: 90, height: 38 }); y += 40; }
        catch { y += 4; }
    } else { y += 4; }

    doc.lineWidth(0.7).strokeColor('#555').moveTo(sigX, y + 2).lineTo(sigX + 110, y + 2).stroke();
    doc.font('Helvetica').fontSize(7.5).fillColor('#555').text('Authorized Signatory / Principal', sigX, y + 5, { width: 110, align: 'center' });

    // Stamp (right)
    const stampX = PW - M - 110;
    if (stampBuf) {
        try { doc.image(stampBuf, stampX, y - (sigBuf ? 38 : 4), { width: 90, height: 38 }); }
        catch {}
    }
    doc.lineWidth(0.7).strokeColor('#555').moveTo(stampX, y + 2).lineTo(stampX + 110, y + 2).stroke();
    doc.font('Helvetica').fontSize(7.5).fillColor('#555').text('School Stamp & Seal', stampX, y + 5, { width: 110, align: 'center' });

    y += 20;

    doc.font('Helvetica').fontSize(7).fillColor('#9e9e9e');
    doc.text('★  This is a computer generated receipt. It is valid without manual signature if duly stamped.  ★', M, y, { width: CW, align: 'center' });

    doc.end();
    return new Promise<Buffer>((resolve, reject) => {
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);
    });
}
