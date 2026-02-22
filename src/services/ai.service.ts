import Student from '../models/student.model';
import FeePayment from '../models/feePayment.model';
import FeeStructure from '../models/feeStructure.model';
import ExamResult from '../models/examResult.model';
import User from '../models/user.model';
import Bus from '../models/bus.model';
import Session from '../models/session.model';
import { generateWithGemini } from '../utils/gemini';

export type IntentType =
    | 'student_lookup'
    | 'teacher_lookup'
    | 'fee_structure_query'
    | 'performance_summary'
    | 'defaulters'
    | 'system_help'
    | 'general';

interface DetectedIntent {
    type: IntentType;
    params?: { studentName?: string; className?: string; teacherName?: string };
}

const SYSTEM_GUIDE = [
    'You are a helpful AI assistant for a School Management System (SSMS). You ONLY:',
    '- Read and explain data that is provided to you as JSON/text',
    '- Summarize student/teacher/fee/performance information in a professional way',
    '- Give step-by-step guidance for using the system when asked',
    'You NEVER: delete, update, or modify any data. You cannot access the database. You only format and explain the data given to you.',
    '',
    'PRIVACY (MANDATORY): All data provided to you belongs to ONE school only—the school of the logged-in user. You must NEVER refer to, infer, or mention data from any other school. Each school\'s data is strictly isolated. If asked about another school or cross-school data, say you only have access to the current school\'s data.',
    '',
    'LANGUAGE RULE (MANDATORY):',
    '- If the user writes in Hindi or asks "Hindi mein batao", "Hindi mein jawab do", "reply in Hindi" → you MUST respond entirely in Hindi.',
    '- If the user writes in English or asks "in English", "reply in English" → respond entirely in English.',
    '- If the user asks for "mix", "dono", "both languages" → you may use a mix of Hindi and English as appropriate.',
    '- Default: respond in the SAME language the user used in their message. Hindi message → Hindi reply. English message → English reply.',
    "- Never ignore the user's language. Never reply in a different language than requested. Keep responses clear and concise.",
].join('\n');

/** Detect preferred response language from user message. */
function detectResponseLanguage(message: string): 'hindi' | 'english' | 'mix' {
    const lower = message.toLowerCase().trim();
    const hasDevanagari = /[\u0900-\u097F]/.test(message);

    if (/mix|dono|both|donon|dono mein|both languages/i.test(lower)) return 'mix';
    if (/english|angrezi|in english|reply in english|english me|english mein/i.test(lower)) return 'english';
    if (/hindi|hindustani|hindi mein|hindi me|reply in hindi|jawab hindi|batao hindi|hindi mein batao|hindi mein jawab/i.test(lower)) return 'hindi';
    if (hasDevanagari) return 'hindi';
    return 'english';
}

function languageInstruction(lang: 'hindi' | 'english' | 'mix'): string {
    if (lang === 'hindi') return 'IMPORTANT: You MUST respond entirely in Hindi (हिंदी). Use Hindi for the whole answer.';
    if (lang === 'mix') return 'IMPORTANT: You may use a mix of Hindi and English (Hinglish) as appropriate for the user.';
    return 'IMPORTANT: You MUST respond entirely in English.';
}

function detectIntent(message: string): DetectedIntent {
    const lower = message.toLowerCase().trim();

    if (/delete|update|modify|change|set|remove|drop/i.test(lower) && /student|fee|salary|database|all/i.test(lower)) {
        return { type: 'general' };
    }

    if (/defaulters|pending fee|dues|unpaid|overdue/i.test(lower)) {
        return { type: 'defaulters' };
    }

    if (/kaise|how to|help|session create|class create|student add|report|guide|steps/i.test(lower)) {
        return { type: 'system_help' };
    }

    if (/fee structure|fee kitni|class.*fee|third class fee|total fee|breakdown/i.test(lower) || /fee.*class|class.*ki fee/i.test(lower)) {
        const classMatch = lower.match(/class\s*(\d+|[ivx]+|nursery|1st|2nd|3rd|4th|5th|6th|7th|8th|9th|10th|11th|12th)/i)
            || lower.match(/(\d+)\s*class|class\s*(\d+)/i);
        const className = classMatch ? (classMatch[1] || classMatch[2] || '').trim() : undefined;
        return { type: 'fee_structure_query', params: { className } };
    }

    if (/teacher|sir|ma'am|maam|staff|joining|salary.*teacher/i.test(lower) && !/student/i.test(lower)) {
        const nameMatch = lower.replace(/sir|ma'am|maam|teacher|ke baare|about|details|batao|batao|info/gi, '').trim();
        const teacherName = nameMatch.length > 1 ? nameMatch : undefined;
        return { type: 'teacher_lookup', params: { teacherName } };
    }

    if (/performance|marks|exam|result|academic|trend|improvement|weak|strong subject/i.test(lower)
        || /student.*marks|marks.*student/i.test(lower)) {
        const namePart = lower.replace(/performance|marks|exam|result|details|batao|info|class/gi, '').trim();
        const parts = namePart.split(/\s+/).filter(Boolean);
        const possibleName = parts[0];
        const classMatch = lower.match(/class\s*(\d+|[ivx]+)/i) || lower.match(/(\d+)(?:\s*st|\s*nd|\s*rd|\s*th)?\s*(?:class|grade)/i);
        return {
            type: 'performance_summary',
            params: { studentName: possibleName || undefined, className: classMatch ? (classMatch[1] || '').trim() : undefined },
        };
    }

    if (/student|details|batao|info|history|admission|shagun|name|class\s*\d/i.test(lower)) {
        const classMatch = lower.match(/class\s*(\d+|[ivx]+|nursery)/i) || lower.match(/(\d+)(?:\s*st|\s*nd|\s*rd|\s*th)?\s*(?:class|grade|th)/i);
        const className = classMatch ? (classMatch[1] || '').trim() : undefined;
        const noClassWords = /class|details|batao|info|history|student|ki|ke|ka|batao|do|dijiye/gi;
        const namePart = lower.replace(noClassWords, ' ').replace(/\s+/g, ' ').trim();
        const studentName = namePart.length > 0 ? namePart.split(/\s+/)[0] : undefined;
        return { type: 'student_lookup', params: { studentName, className } };
    }

    return { type: 'general' };
}

async function findStudentByNameAndClass(schoolId: string, name?: string, className?: string): Promise<any | null> {
    const filter: any = { schoolId, isActive: true };
    if (className) filter.class = className;
    if (name) {
        const nameRegex = new RegExp(name.replace(/\s+/g, '.*'), 'i');
        filter.$or = [{ firstName: nameRegex }, { lastName: nameRegex }];
    }
    let students = await Student.find(filter).limit(10).lean();
    if (students.length === 0 && className) {
        filter.class = new RegExp(`^${className}`, 'i');
        students = await Student.find(filter).limit(10).lean();
    }
    if (students.length === 0) return null;
    if (students.length === 1) return students[0];
    if (name) {
        const lower = name.toLowerCase();
        const match = (students as any[]).find(
            (s) =>
                `${(s.firstName || '')} ${(s.lastName || '')}`.toLowerCase().includes(lower) ||
                (s.firstName || '').toLowerCase().includes(lower) ||
                (s.lastName || '').toLowerCase().includes(lower)
        );
        return match || students[0];
    }
    return students[0];
}

export async function processAIQuery(schoolId: string, message: string): Promise<string> {
    const intent = detectIntent(message);
    const responseLang = detectResponseLanguage(message);
    const langInstr = languageInstruction(responseLang);

    if (intent.type === 'general' && /delete|update|modify|change.*(all|database)/i.test(message)) {
        return responseLang === 'hindi'
            ? 'मैं केवल जानकारी और मार्गदर्शन दे सकता हूँ। डेटा हटाने या बदलने जैसे काम सिस्टम में खुद करने होंगे।'
            : 'I can only provide insights and guidance. Administrative actions (like deleting or modifying data) must be performed manually in the system.';
    }

    if (intent.type === 'student_lookup') {
        const student = await findStudentByNameAndClass(schoolId, intent.params?.studentName, intent.params?.className);
        if (!student) {
            const namePart = intent.params?.studentName || '';
            const classPart = intent.params?.className ? ` कक्षा ${intent.params.className} में` : '';
            return responseLang === 'hindi'
                ? `"${namePart}"${classPart} से मेल खाता कोई छात्र नहीं मिला। कृपया नाम और कक्षा जाँचें।`
                : `No student found matching "${namePart}"${intent.params?.className ? ` in class ${intent.params.className}` : ''}. Please check the name and class.`;
        }
        const payments = await FeePayment.find({ schoolId, studentId: student._id }).sort({ paymentDate: -1 }).limit(20).lean();
        const results = await ExamResult.find({ schoolId, studentId: student._id }).populate('examId', 'title').sort({ createdAt: -1 }).limit(5).lean();
        let busInfo = null;
        if ((student as any).busId) {
            const bus = await Bus.findById((student as any).busId).lean();
            if (bus) busInfo = { busNumber: (bus as any).busNumber, routeName: (bus as any).routeName };
        }
        const lastExam = (results as any[])[0];
        const examSubjects = lastExam?.subjects?.map((s: any) => ({ subject: s.subject, obtained: s.obtainedMarks, max: s.maxMarks })) || [];
        const payload = {
            student: {
                name: `${(student as any).firstName} ${(student as any).lastName}`,
                admissionNumber: (student as any).admissionNumber,
                class: (student as any).class,
                section: (student as any).section,
                admissionDate: (student as any).admissionDate,
                fatherName: (student as any).fatherName,
                motherName: (student as any).motherName,
                phone: (student as any).phone,
                totalYearlyFee: (student as any).totalYearlyFee,
                paidAmount: (student as any).paidAmount,
                dueAmount: (student as any).dueAmount,
                usesTransport: (student as any).usesTransport,
                bus: busInfo,
            },
            feePaymentsCount: payments.length,
            recentPayments: (payments as any[]).slice(0, 5).map((p) => ({ amount: p.amountPaid, date: p.paymentDate, mode: p.paymentMode })),
            lastExam: lastExam ? { title: (lastExam as any).examId?.title, percentage: lastExam.percentage, grade: lastExam.grade, subjects: examSubjects } : null,
            examResultsCount: results.length,
        };
        const prompt = `User asked: "${message}"\n\nBased on the following student data (JSON), generate a professional summary. Include: Admission & basic info, Fee summary (total, paid, due), Payment history summary, Exam/performance summary, Bus/transport (if any), and 1-2 lines on strength/weakness/trend if you can infer from data.\n\nDATA:\n${JSON.stringify(payload, null, 2)}`;
        return await generateWithGemini(prompt, `${SYSTEM_GUIDE}\n\n${langInstr}`);
    }

    if (intent.type === 'teacher_lookup') {
        const filter: any = { schoolId, role: 'teacher', isActive: true };
        if (intent.params?.teacherName) {
            const nameRegex = new RegExp(intent.params.teacherName.replace(/\s/g, '.*'), 'i');
            filter.name = nameRegex;
        }
        const teachers = await User.find(filter).select('name email phone role subject qualification baseSalary createdAt').limit(5).lean();
        if (teachers.length === 0) {
            if (responseLang === 'hindi') {
                return intent.params?.teacherName
                    ? `"${intent.params.teacherName}" नाम से कोई शिक्षक नहीं मिला।`
                    : 'कोई शिक्षक नहीं मिला।';
            }
            return intent.params?.teacherName
                ? `No teacher found with name matching "${intent.params.teacherName}".`
                : 'No teachers found.';
        }
        const t = (teachers as any[])[0];
        const payload = {
            name: t.name,
            email: t.email,
            phone: t.phone,
            subject: t.subject,
            qualification: t.qualification,
            baseSalary: t.baseSalary,
            joiningDate: t.createdAt,
        };
        const prompt = `User asked: "${message}"\n\nBased on the following teacher/staff data (JSON), give a short professional summary.\n\nDATA:\n${JSON.stringify(payload, null, 2)}`;
        return await generateWithGemini(prompt, `${SYSTEM_GUIDE}\n\n${langInstr}`);
    }

    if (intent.type === 'fee_structure_query') {
        const session = await Session.findOne({ schoolId, isActive: true }).lean();
        if (!session) {
            return responseLang === 'hindi'
                ? 'कोई सक्रिय सत्र नहीं मिला। फीस संरचना सत्र के अनुसार सेट होती है।'
                : 'No active session found. Fee structure is set per session.';
        }
        const className = intent.params?.className || message.match(/class\s*(\d+|[ivx]+)/i)?.[1] || '';
        const structures = await FeeStructure.find({ schoolId, sessionId: session._id }).lean();
        const match = (structures as any[]).find((s) => s.class === className || (className && String(s.class).includes(className)));
        const structure = match || (structures as any[])[0];
        if (!structure) {
            return responseLang === 'hindi'
                ? 'इस सत्र के लिए कोई फीस संरचना नहीं मिली।'
                : 'No fee structure found for this session.';
        }
        const payload = {
            class: (structure as any).class,
            totalAmount: (structure as any).totalAmount ?? (structure as any).totalAnnualFee,
            components: (structure as any).components || [],
        };
        const prompt = `User asked: "${message}"\n\nBased on the following fee structure (JSON), answer clearly. Include total and breakdown if present.\n\nDATA:\n${JSON.stringify(payload, null, 2)}`;
        return await generateWithGemini(prompt, `${SYSTEM_GUIDE}\n\n${langInstr}`);
    }

    if (intent.type === 'performance_summary' && (intent.params?.studentName || intent.params?.className)) {
        const student = await findStudentByNameAndClass(schoolId, intent.params?.studentName, intent.params?.className);
        if (!student) {
            return responseLang === 'hindi'
                ? 'कोई छात्र नहीं मिला। कृपया नाम और कक्षा बताएँ।'
                : 'No student found. Please specify name and class.';
        }
        const results = await ExamResult.find({ schoolId, studentId: student._id }).populate('examId', 'title').sort({ createdAt: -1 }).limit(5).lean();
        const subjects: { subject: string; marks: number; max: number }[] = [];
        (results as any[]).forEach((r) => {
            (r.subjects || []).forEach((s: any) => {
                subjects.push({ subject: s.subject, marks: s.obtainedMarks, max: s.maxMarks });
            });
        });
        const payload = {
            studentName: `${(student as any).firstName} ${(student as any).lastName}`,
            class: (student as any).class,
            examResults: (results as any[]).map((r) => ({ exam: (r as any).examId?.title, percentage: r.percentage, grade: r.grade })),
            subjectsSummary: subjects,
        };
        const prompt = `User asked: "${message}"\n\nBased on the following performance data (JSON), analyze: strong subject, weak subject, trend, and suggest one or two improvements.\n\nDATA:\n${JSON.stringify(payload, null, 2)}`;
        return await generateWithGemini(prompt, `${SYSTEM_GUIDE}\n\n${langInstr}`);
    }

    if (intent.type === 'defaulters') {
        const defaulters = await Student.find({ schoolId, isActive: true, dueAmount: { $gt: 0 } })
            .select('firstName lastName class section dueAmount')
            .sort({ dueAmount: -1 })
            .limit(30)
            .lean();
        const payload = {
            count: defaulters.length,
            totalDue: (defaulters as any[]).reduce((s, d) => s + (d.dueAmount || 0), 0),
            sample: (defaulters as any[]).slice(0, 10).map((d) => ({ name: `${d.firstName} ${d.lastName}`, class: d.class, due: d.dueAmount })),
        };
        const prompt = `User asked: "${message}"\n\nBased on the following defaulters/fee dues data (JSON), give a short summary: how many defaulters, total pending amount, and any note.\n\nDATA:\n${JSON.stringify(payload, null, 2)}`;
        return await generateWithGemini(prompt, `${SYSTEM_GUIDE}\n\n${langInstr}`);
    }

    if (intent.type === 'system_help') {
        const guide = `
COMPLETE SYSTEM GUIDE — School Management System (SMS)

=== DASHBOARD ===
- School Dashboard: Shows total students, total fees collected, pending dues, recent activity.
- Master Dashboard (Super Admin only): Shows total schools, active subscriptions, billing overview.

=== SESSIONS ===
- Go to Sessions → Add New Session.
- Fill: Session Year (e.g. 2025-2026), Start Date, End Date. Only ONE session can be active.
- Active session determines which fee structures, exams, and data is current.

=== CLASSES & SECTIONS ===
- Go to Classes → Add Class & Section.
- Each class + section is a SEPARATE entry (e.g. Class 4 Section A, Class 4 Section B).
- You can set Room Number and Capacity (both optional).
- Click "View Students" to see students in that class. Click a student to see their full profile.
- To edit/delete a class, use the edit/delete icons on the class card.

=== STUDENTS ===
- Add Student: Go to Students → Add Student button. Fill all required fields.
  Required: First Name, Last Name, Father's Name, Mother's Name, Date of Birth, Gender, Class, Section, Phone, Address.
  Optional: Email, Photo, Initial Deposit Amount, Payment Mode.
- Edit Student: Click the edit (pencil) icon on any student row in the Students list.
- Delete Student: Click the trash icon. This will ask for confirmation.
- Import CSV: Click "Import CSV" to bulk import students from a CSV file.
  CSV headers: firstname, lastname, fathername, mothername, class, section, phone, gender, address, city, state, pincode, dob
- Export CSV: Click "Export CSV" to download all students.
- Search: Use the search bar to find students by name or admission number.

=== FEE MANAGEMENT ===
- Fee Structure: Go to Fee Structure → Create structure for each class/session.
  Add components (Tuition, Lab, Library, etc.) with amounts. Total is calculated automatically.
- Collect Fee: Go to Collect Fee → Search/select student → Enter amount, payment mode (Cash/UPI/Online/Cheque/Bank), reference number.
- Receipts: Go to Receipts → View, Preview, Download, or Print any receipt.
- Defaulters: Go to Defaulters → See all students with pending dues. Sorted by class.

=== EXAMS ===
- Create Exam: Go to Exams → New Exam. Fill title, type (Unit Test/Mid Term/Final/Other), dates, and select classes.
- Enter Marks: Click "Enter Marks" on any exam → Select class → Add subjects (name + max marks) → Enter obtained marks for each student → Save.
- View Results: Click "View Results" on an exam to see all student results with percentage and grade.
- Merit List: Auto-generated when results are saved. Ranked by percentage.
- Admit Cards: Select exam → Admit Cards → Filter by class/section → Preview/Download/Print PDF.

=== STAFF & PAYROLL ===
- Staff: Go to Staff → Add Staff (name, role, email, phone, salary).
- Staff Detail: Click on a staff member to see their salary structure, payment history, bonuses/adjustments.
- Salary Structure: Set base salary, add allowances (HRA, DA, etc.) and deductions (PF, TDS, etc.).
- Payroll: Go to Payroll → Select month/year → Generate Payroll → Review → Pay each staff member.
  Payment modes: Cash, UPI, Online, Cheque, Bank Transfer. Can add transaction ID and remarks.
- Salary Slip: Click the eye icon on any payroll record to view/print salary slip as PDF.

=== TRANSPORT ===
- Go to Transport → Add Bus (number, route, driver, capacity).
- Assign students to buses from their profile or the transport page.

=== TIMETABLE ===
- Settings: Go to Timetable → Settings → Configure period timings (start/end time for each period).
- Grid: Timetable → Select class/section → Fill subject and teacher for each period/day.
- Save/Print: Save the timetable, then print or download as PDF.

=== NOTIFICATIONS ===
- Send SMS: Go to Notifications → Send SMS tab.
  Select target: All Students, Fee Defaulters, or Custom Selection.
  Use templates or write custom message. Dynamic variables work:
  {name} = student name, {amount} = due amount, {school} = school name, {date} = today, {class} = class, {fatherName} = father name
  Preview before sending. Character counter shows SMS segments.
- Send Email: Go to Notifications → Send Email tab.
  First connect Gmail (click "Sign in with Google"). Then compose subject + body.
  Same dynamic variables work in email too.
  Supports basic HTML formatting.
- History: View all sent notifications with delivery stats.

=== AI ASSISTANT (This is me!) ===
- Ask about any student: "Tell me about Shagun class 4"
- Ask about fees: "Class 3 fee structure", "Fee defaulters"
- Ask about performance: "Shagun marks", "performance summary"
- Ask about teachers: "Teacher Rahul details"
- Ask for help: "How to create session", "How to add student", "How to collect fee"
- I support Hindi, English, and mixed language.

=== PLAN & BILLING ===
- Go to Plan & Billing to see current plan, features, and upgrade options.
- Payments are processed via PhonePe.

=== SETTINGS ===
- School Identity: Update school name, email, address.
- Notification preferences for SMS and Email alerts.

=== COMMON ERRORS & SOLUTIONS ===
- "No active session": Create a session first in Sessions page. Only one can be active.
- "Student not found": Check the name spelling or try with admission number.
- "Fee structure not found": Create fee structure for the class in Fee Structure page.
- "Class not found": Create the class first in Classes page.
- Marks not saving: Make sure you selected a class, added subjects, and entered marks. Click Save.
- Gmail not working: Check that GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI are set. Click Connect Gmail.
- SMS not sending: Check TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER are set correctly.
- Payment failed: Check PhonePe credentials in server .env. For sandbox, use PHONEPE_ENV=sandbox.
`;
        const prompt = `User asked: "${message}"\n\nUsing the following COMPREHENSIVE system guide, answer thoroughly step-by-step. Be specific about which page to go to, which buttons to click, and what to fill. If they have an error, diagnose it using the common errors section.\n\n${guide}`;
        return await generateWithGemini(prompt, `${SYSTEM_GUIDE}\n\n${langInstr}`);
    }

    const prompt = `User asked: "${message}"\n\nYou are a school management AI assistant. Respond briefly and helpfully. If they are asking for student/teacher/fee/performance data, suggest they try: "Shagun class 10 details" or "Class 3 fee" or "Defaulters" or "How to create session".`;
    return await generateWithGemini(prompt, `${SYSTEM_GUIDE}\n\n${langInstr}`);
}
