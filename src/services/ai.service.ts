import Student from '../models/student.model';
import FeePayment from '../models/feePayment.model';
import FeeStructure from '../models/feeStructure.model';
import ExamResult from '../models/examResult.model';
import Attendance from '../models/attendance.model';
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

const SYSTEM_GUIDE = `
You are a helpful AI assistant for a School Management System (SSMS). You ONLY:
- Read and explain data that is provided to you as JSON/text
- Summarize student/teacher/fee/performance information in a professional way
- Give step-by-step guidance for using the system when asked
You NEVER: delete, update, or modify any data. You cannot access the database. You only format and explain the data given to you.
Respond in the same language as the user (Hindi or English). Keep responses clear and concise.`;

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

    if (intent.type === 'general' && /delete|update|modify|change.*(all|database)/i.test(message)) {
        return 'I can only provide insights and guidance. Administrative actions (like deleting or modifying data) must be performed manually in the system.';
    }

    if (intent.type === 'student_lookup') {
        const student = await findStudentByNameAndClass(schoolId, intent.params?.studentName, intent.params?.className);
        if (!student) {
            return `No student found matching "${intent.params?.studentName || ''}" ${intent.params?.className ? `in class ${intent.params.className}` : ''}. Please check the name and class.`;
        }
        const payments = await FeePayment.find({ schoolId, studentId: student._id }).sort({ paymentDate: -1 }).limit(20).lean();
        const results = await ExamResult.find({ schoolId, studentId: student._id }).populate('examId', 'title').sort({ createdAt: -1 }).limit(5).lean();
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const attendanceCount = await Attendance.countDocuments({ schoolId, studentId: student._id, date: { $gte: thirtyDaysAgo } });
        const presentCount = await Attendance.countDocuments({ schoolId, studentId: student._id, date: { $gte: thirtyDaysAgo }, status: 'present' });
        const attendancePercentage = attendanceCount > 0 ? Math.round((presentCount / attendanceCount) * 100) : null;
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
            attendanceLast30Days: attendanceCount > 0 ? { totalDays: attendanceCount, present: presentCount, percentage: attendancePercentage } : null,
            lastExam: lastExam ? { title: (lastExam as any).examId?.title, percentage: lastExam.percentage, grade: lastExam.grade, subjects: examSubjects } : null,
            examResultsCount: results.length,
        };
        const prompt = `User asked: "${message}"\n\nBased on the following student data (JSON), generate a professional summary. Include: Admission & basic info, Fee summary (total, paid, due), Payment history summary, Attendance (if available), Exam/performance summary, Bus/transport (if any), and 1-2 lines on strength/weakness/trend if you can infer from data. Respond in the same language as the user (Hindi or English).\n\nDATA:\n${JSON.stringify(payload, null, 2)}`;
        return await generateWithGemini(prompt, SYSTEM_GUIDE);
    }

    if (intent.type === 'teacher_lookup') {
        const filter: any = { schoolId, role: 'teacher', isActive: true };
        if (intent.params?.teacherName) {
            const nameRegex = new RegExp(intent.params.teacherName.replace(/\s/g, '.*'), 'i');
            filter.name = nameRegex;
        }
        const teachers = await User.find(filter).select('name email phone role subject qualification baseSalary createdAt').limit(5).lean();
        if (teachers.length === 0) {
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
        const prompt = `User asked: "${message}"\n\nBased on the following teacher/staff data (JSON), give a short professional summary. Respond in the same language as the user.\n\nDATA:\n${JSON.stringify(payload, null, 2)}`;
        return await generateWithGemini(prompt, SYSTEM_GUIDE);
    }

    if (intent.type === 'fee_structure_query') {
        const session = await Session.findOne({ schoolId, isActive: true }).lean();
        if (!session) return 'No active session found. Fee structure is set per session.';
        const className = intent.params?.className || message.match(/class\s*(\d+|[ivx]+)/i)?.[1] || '';
        const structures = await FeeStructure.find({ schoolId, sessionId: session._id }).lean();
        const match = (structures as any[]).find((s) => s.class === className || (className && String(s.class).includes(className)));
        const structure = match || (structures as any[])[0];
        if (!structure) return 'No fee structure found for this session.';
        const payload = {
            class: (structure as any).class,
            totalAmount: (structure as any).totalAmount ?? (structure as any).totalAnnualFee,
            components: (structure as any).components || [],
        };
        const prompt = `User asked: "${message}"\n\nBased on the following fee structure (JSON), answer clearly. Include total and breakdown if present. Respond in the same language as the user.\n\nDATA:\n${JSON.stringify(payload, null, 2)}`;
        return await generateWithGemini(prompt, SYSTEM_GUIDE);
    }

    if (intent.type === 'performance_summary' && (intent.params?.studentName || intent.params?.className)) {
        const student = await findStudentByNameAndClass(schoolId, intent.params?.studentName, intent.params?.className);
        if (!student) return `No student found. Please specify name and class.`;
        const results = await ExamResult.find({ schoolId, studentId: student._id }).populate('examId', 'title').sort({ createdAt: -1 }).limit(5).lean();
        const subjects: { subject: string; marks: number; max: number }[] = [];
        (results as any[]).forEach((r) => {
            (r.subjects || []).forEach((s: any) => {
                subjects.push({ subject: s.subject, marks: s.obtainedMarks, max: s.maxMarks });
            });
        });
        const attendanceCount = await Attendance.countDocuments({ schoolId, studentId: student._id });
        const presentCount = await Attendance.countDocuments({ schoolId, studentId: student._id, status: 'present' });
        const attendancePercentage = attendanceCount > 0 ? Math.round((presentCount / attendanceCount) * 100) : null;
        const payload = {
            studentName: `${(student as any).firstName} ${(student as any).lastName}`,
            class: (student as any).class,
            examResults: (results as any[]).map((r) => ({ exam: (r as any).examId?.title, percentage: r.percentage, grade: r.grade })),
            subjectsSummary: subjects,
            attendancePercentage,
        };
        const prompt = `User asked: "${message}"\n\nBased on the following performance data (JSON), analyze: strong subject, weak subject, trend, and suggest one or two improvements. Respond in the same language as the user.\n\nDATA:\n${JSON.stringify(payload, null, 2)}`;
        return await generateWithGemini(prompt, SYSTEM_GUIDE);
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
        const prompt = `User asked: "${message}"\n\nBased on the following defaulters/fee dues data (JSON), give a short summary: how many defaulters, total pending amount, and any note. Respond in the same language as the user.\n\nDATA:\n${JSON.stringify(payload, null, 2)}`;
        return await generateWithGemini(prompt, SYSTEM_GUIDE);
    }

    if (intent.type === 'system_help') {
        const guide = `
System help (SSMS):
- To create session: Go to Dashboard → Sessions → Add New. Fill start date, end date, session year. Save.
- To create class: Go to Classes → Add Class. Enter class name and sections.
- To add student: Go to Students → Add Student. Fill admission and personal details.
- To collect fee: Go to Collect Fee → Select student → Enter amount and payment mode.
- To view receipts: Go to Receipts. You can Preview/Download/Print.
- To generate report: Use Dashboard for overview; Fee Structure and Defaulters for fee reports.
- Timetable: Timetable → Settings (set periods) → Timetable grid (fill subjects/teachers) → Save/Print.
- Admit cards: Exams → Select exam → Admit Cards → Generate by class/section → Preview/Download/Print.
`;
        const prompt = `User asked: "${message}"\n\nUsing ONLY the following system guide, answer step-by-step in the same language as the user. If the question is not covered, say you can only help with the listed features.\n\n${guide}`;
        return await generateWithGemini(prompt, SYSTEM_GUIDE);
    }

    const prompt = `User asked: "${message}"\n\nYou are a school management AI assistant. Respond briefly and helpfully in the same language as the user. If they are asking for student/teacher/fee/performance data, suggest they try: "Shagun class 10 details" or "Class 3 fee" or "Defaulters" or "How to create session".`;
    return await generateWithGemini(prompt, SYSTEM_GUIDE);
}
