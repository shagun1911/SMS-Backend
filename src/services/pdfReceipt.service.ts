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
    // Academic month for which this receipt amount was applied (e.g. "March" or "One-Time")
    feeMonth?: string;
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
        sessionYear, feeMonth, feeComponents, concession = 0, lateFee = 0,
    } = opts;

    // The student-level concession (typically applied at admission) is often already reflected
    // in `student.totalYearlyFee`. So we use it for the display row only, without impacting
    // the current net-fee calculation.
    const concessionDisplay = Number((student as any).concessionAmount) || 0;
    const concessionValueForRow = concessionDisplay > 0 ? concessionDisplay : concession;

    const doc = new PDFDocument({ size: 'A4', margin: 0, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));

    const [logoBuf, stampBuf, sigBuf] = await Promise.all([
        fetchImageBuffer(school.logo),
        fetchImageBuffer((school as any).stamp),
        fetchImageBuffer((school as any).principalSignature),
    ]);

    // ── OUTER BORDER (soft / pastel) ─────────────────────────────────────────
    doc.rect(8, 8, PW - 16, 826).lineWidth(2).strokeColor('#4f46e5').stroke();
    doc.rect(11, 11, PW - 22, 820).lineWidth(0.5).strokeColor('#c7d2fe').stroke();

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

    doc.fontSize(19).font('Helvetica-Bold').fillColor('#4f46e5');
    doc.text(schoolName, M + LOGO_SZ + 8, y + 4, { width: CW - LOGO_SZ - 8, align: 'center' });

    if (board) {
        doc.fontSize(8).font('Helvetica').fillColor('#c62828');
        doc.text(board, M + LOGO_SZ + 8, y + 28, { width: CW - LOGO_SZ - 8, align: 'center' });
    }

    doc.fontSize(8.5).font('Helvetica').fillColor('#424242');
    doc.text(addr || '—', M + LOGO_SZ + 8, y + (board ? 40 : 30), { width: CW - LOGO_SZ - 8, align: 'center' });
    doc.text(contact || '—', M + LOGO_SZ + 8, y + (board ? 52 : 42), { width: CW - LOGO_SZ - 8, align: 'center' });

    y += LOGO_SZ + 12;
    hLine(doc, y, '#4f46e5', 1.5);
    y += 2;

    // ── TITLE BAR ──────────────────────────────────────────────────────────────
    doc.rect(M, y, CW, 22).fill('#4f46e5');
    doc.fontSize(12).font('Helvetica-Bold').fillColor('#ffffff');
    doc.text('FEE RECEIPT', M, y + 5, { width: CW, align: 'center' });
    y += 22;

    // ── INFO STRIP (Receipt No | Date | Session) ──────────────────────────────
    doc.rect(M, y, CW, 20).fill('#eef2ff');
    doc.fontSize(8.5).font('Helvetica-Bold').fillColor('#4f46e5');
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

    const feeMonthDisplay = (() => {
        const m = (feeMonth || '').toString();
        if (!m) return sessionYear ? 'Apr–Mar (12 Months)' : '—';
        if (m.toLowerCase() === 'one-time' || m.toLowerCase() === 'one_time') return 'Admission (One-time)';
        // Expected values here are like "January", "February", ..., "March", etc.
        return m;
    })();

    const detailRows: [string, string, string, string][] = [
        ['Name', studentName || '—', 'SID', student.admissionNumber || '—'],
        ["Father's Name", student.fatherName || '—', 'Mobile', phone || '—'],
        ["Mother's Name", motherName || '—', 'Class / Section', `${student.class || '—'} - ${student.section || '—'}`],
        ['Roll No', String(rollNo), 'Fee Upto Month', feeMonthDisplay],
    ];

    // Bigger row height so long values (like Father/Mother names or Class-Section)
    // don't look "cut" when they wrap to 2 lines.
    const rowH = 22;
    const halfW = CW / 2;
    // Reduce label width to give more room to values (prevents text clipping).
    const lw = 44; // label column width

    detailRows.forEach((row, i) => {
        const bg = i % 2 === 0 ? '#fafafa' : '#f5f5f5';
        doc.rect(M, y, CW, rowH).fill(bg);
        hLine(doc, y + rowH, '#e0e0e0', 0.4);
        doc.lineWidth(0.4).strokeColor('#e0e0e0').moveTo(M + halfW, y).lineTo(M + halfW, y + rowH).stroke();

        doc.fontSize(7.5).font('Helvetica-Bold').fillColor('#4f46e5');
        doc.text(`${row[0]}:`, M + 6, y + 4, { width: lw, align: 'left' });
        doc.fontSize(7.5).font('Helvetica').fillColor('#111827');
        doc.text(row[1], M + lw + 4, y + 4, { width: halfW - lw - 8, align: 'left' });

        doc.fontSize(7.5).font('Helvetica-Bold').fillColor('#4f46e5');
        doc.text(`${row[2]}:`, M + halfW + 6, y + 4, { width: lw, align: 'left' });
        doc.fontSize(7.5).font('Helvetica').fillColor('#111827');
        doc.text(row[3], M + halfW + lw + 4, y + 4, { width: halfW - lw - 8, align: 'left' });

        y += rowH;
    });

    hLine(doc, y, '#c7d2fe', 0.8);
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
        { label: 'Total Fee', value: totalAnnualFee, fg: '#111827', bg: '#eef2ff', bold: false },
        {
            label: '(+) Old Balance',
            value: payment.previousDue > thisPayment + remainingDue ? payment.previousDue - thisPayment - remainingDue : 0,
            fg: '#b91c1c',
            bg: '#fee2e2',
            bold: false,
        },
        { label: '(+) Additional / Late Fee', value: lateFee, fg: '#ea580c', bg: '#ffedd5', bold: false },
        { label: '(-) Concession / Discount', value: concessionValueForRow, fg: '#15803d', bg: '#dcfce7', bold: false },
        { label: 'NET FEE', value: netFee, fg: '#ffffff', bg: '#4f46e5', bold: true },
        ...(previousPaid > 0 ? [{ label: '(+) Paid at Admission', value: previousPaid, fg: '#15803d', bg: '#dcfce7', bold: false }] : []),
        { label: previousPaid > 0 ? 'AMOUNT RECEIVED (This Payment)' : 'AMOUNT RECEIVED', value: thisPayment, fg: '#ffffff', bg: '#16a34a', bold: true },
        ...(previousPaid > 0 ? [{ label: 'TOTAL PAID TO DATE', value: previousPaid + thisPayment, fg: '#ffffff', bg: '#15803d', bold: true }] : []),
        { label: 'BALANCE DUE', value: balance, fg: '#ffffff', bg: balance > 0 ? '#b91c1c' : '#15803d', bold: true },
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

    // ── PAYMENT INFO (tighter + consistent alignment) ─────────────────────
    doc.rect(M, y, CW, 50).fillAndStroke('#f8fafc', '#c7d2fe');
    // Keep rows compact so labels/values don't look spaced out.
    const pInfoY = y + 6;
    const leftX = M + 8;
    const midX = M + CW / 2;
    const leftW = CW / 2 - 20;
    const rightW = CW - leftW - 10;

    // Row 1: Payment Mode (left) + Total Paid Amount (right)
    doc.fontSize(7.5).font('Helvetica-Bold').fillColor('#4f46e5')
        .text('Payment Mode:', leftX, pInfoY, { width: 95, align: 'left' });
    doc.fontSize(7.5).font('Helvetica').fillColor('#111827')
        .text((payment.paymentMode || 'Cash').toUpperCase(), leftX + 95, pInfoY, { width: leftW - 95, align: 'left' });

    doc.fontSize(7.5).font('Helvetica-Bold').fillColor('#4f46e5')
        .text('Total Paid:', midX, pInfoY, { width: 105, align: 'left' });
    // Anchor the value to the right edge of the payment box to avoid overflow.
    const totalPaidStr = `₹${money(thisPayment)}`;
    doc.fontSize(7.5).font('Helvetica').fillColor('#111827');
    const totalPaidTextW = doc.widthOfString(totalPaidStr);
    const totalPaidValueRightX = M + CW - 10; // right padding inside the box
    const totalPaidValueX = totalPaidValueRightX - totalPaidTextW;
    doc.text(totalPaidStr, totalPaidValueX, pInfoY, { align: 'left' });

    // Row 2: Amount in Word (full width)
    const amountRowY = pInfoY + 12;
    doc.fontSize(7.5).font('Helvetica-Bold').fillColor('#4f46e5')
        .text('Amount (Words):', leftX, amountRowY, { width: 118, align: 'left' });
    doc.fontSize(7.5).font('Helvetica').fillColor('#111827')
        .text(numberToWords(thisPayment), leftX + 118, amountRowY, { width: CW - (118 + 14), align: 'left' });

    // Row 3: Received By line
    const receivedRowY = pInfoY + 22;
    doc.fontSize(7.5).font('Helvetica-Bold').fillColor('#4f46e5')
        .text('Received By:', leftX, receivedRowY, { width: 95, align: 'left' });
    doc.lineWidth(0.7).strokeColor('#94a3b8')
        // Underline directly under "Received By" and spanning the left half.
        .moveTo(leftX + 95, receivedRowY + 6)
        .lineTo(leftX + leftW - 10, receivedRowY + 6)
        .stroke();

    y += 50 + 6;

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
