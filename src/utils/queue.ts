import { Queue, Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import config from '../config';
import { sendBulkSms } from '../services/twilio.service';
import { sendBulkEmail } from '../services/gmail.service';
import Notification from '../models/notification.model';
import Student from '../models/student.model';
import { Types } from 'mongoose';
import FeeService from '../services/fee.service';

const connection = new IORedis(config.redis.url, { maxRetriesPerRequest: null, enableReadyCheck: false });

export const notificationQueue = new Queue('notificationQueue', { connection });
export const feeGenerationQueue = new Queue('feeGenerationQueue', { connection });
export const salaryGenerationQueue = new Queue('salaryGenerationQueue', { connection });

interface NotificationJobData {
    notificationId: string;
    schoolId: string;
    type: 'sms' | 'email';
    targetGroup: string;
    customIds?: string[];
    message: string;
    subject?: string;
    schoolName: string;
    tokens?: any; // For Gmail
}

interface FeeGenerationJobData {
    schoolId: string;
    className: string;
    month: string;
    dueDate: Date;
    staffId: string;
}

interface SalaryGenerationJobData {
    schoolId: string;
    month: string;
    year: number;
    specificStaffId?: string;
}

// Reuse the same logic for variable replacement
function replaceVars(template: string, student: any, schoolName: string): string {
    return template
        .replace(/\{name\}/gi, student.fullName || `${student.firstName || ''} ${student.lastName || ''}`.trim())
        .replace(/\{firstName\}/gi, student.firstName || '')
        .replace(/\{lastName\}/gi, student.lastName || '')
        .replace(/\{fatherName\}/gi, student.fatherName || '')
        .replace(/\{motherName\}/gi, student.motherName || '')
        .replace(/\{class\}/gi, student.class || '')
        .replace(/\{section\}/gi, student.section || '')
        .replace(/\{phone\}/gi, student.phone || '')
        .replace(/\{email\}/gi, student.email || '')
        .replace(/\{admissionNumber\}/gi, student.admissionNumber || '')
        .replace(/\{amount\}/gi, student.dueAmount != null ? `₹${Number(student.dueAmount).toLocaleString('en-IN')}` : '₹0')
        .replace(/\{dueAmount\}/gi, student.dueAmount != null ? `₹${Number(student.dueAmount).toLocaleString('en-IN')}` : '₹0')
        .replace(/\{paidAmount\}/gi, student.paidAmount != null ? `₹${Number(student.paidAmount).toLocaleString('en-IN')}` : '₹0')
        .replace(/\{totalFee\}/gi, student.totalYearlyFee != null ? `₹${Number(student.totalYearlyFee).toLocaleString('en-IN')}` : '₹0')
        .replace(/\{school\}/gi, schoolName)
        .replace(/\{date\}/gi, new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }))
        .replace(/\{dueDate\}/gi, new Date(Date.now() + 7 * 86400000).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }));
}

async function getTargetStudents(schoolId: string, target: string, customIds?: string[]) {
    const filter: any = { schoolId: new Types.ObjectId(schoolId), isActive: true };
    if (target === 'defaulters') filter.dueAmount = { $gt: 0 };
    if (target === 'custom' && customIds?.length) filter._id = { $in: customIds.map((id) => new Types.ObjectId(id)) };
    return Student.find(filter).sort({ class: 1, section: 1 }).lean();
}

export async function startWorkers() {
    // 1. Notification Worker
    const notificationWorker = new Worker('notificationQueue', async (job: Job<NotificationJobData>) => {
        const { notificationId, schoolId, type, targetGroup, customIds, message, subject, schoolName, tokens } = job.data;
        const notif = await Notification.findById(notificationId);
        if (!notif) return;

        try {
            const students = await getTargetStudents(schoolId, targetGroup, customIds);
            const hasVars = /\{[a-zA-Z]+\}/.test(message) || (subject && /\{[a-zA-Z]+\}/.test(subject));
            
            if (type === 'sms') {
                const studentsWithPhone = students.filter((s: any) => s.phone);
                let sent = 0, failed = 0;
                
                if (hasVars) {
                    const BATCH = 10;
                    for (let i = 0; i < studentsWithPhone.length; i += BATCH) {
                        const batch = studentsWithPhone.slice(i, i + BATCH);
                        const promises = batch.map(async (s: any) => {
                            const personalMsg = replaceVars(message, s, schoolName);
                            const r = await sendBulkSms([s.phone], personalMsg);
                            sent += r.sent; failed += r.failed;
                        });
                        await Promise.all(promises);
                    }
                } else {
                    const r = await sendBulkSms(studentsWithPhone.map((s: any) => s.phone), message);
                    sent = r.sent; failed = r.failed;
                }
                
                notif.sentCount = sent;
                notif.failedCount = failed;
                notif.status = failed === studentsWithPhone.length ? 'failed' : 'completed';
                await notif.save();

            } else if (type === 'email') {
                const studentsWithEmail = students.filter((s: any) => s.email);
                let sent = 0, failed = 0;

                if (hasVars && subject) {
                    const BATCH = 5;
                    for (let i = 0; i < studentsWithEmail.length; i += BATCH) {
                        const batch = studentsWithEmail.slice(i, i + BATCH);
                        const promises = batch.map(async (s: any) => {
                            const pSubj = replaceVars(subject, s, schoolName);
                            const pBody = replaceVars(message, s, schoolName);
                            const r = await sendBulkEmail(tokens, [{ email: s.email, name: s.fullName || s.firstName }], pSubj, pBody, schoolName);
                            sent += r.sent; failed += r.failed;
                        });
                        await Promise.all(promises);
                    }
                } else if (subject) {
                    const recipients = studentsWithEmail.map((s: any) => ({ email: s.email, name: s.fullName || s.firstName }));
                    const r = await sendBulkEmail(tokens, recipients, subject, message, schoolName);
                    sent = r.sent; failed = r.failed;
                }
                
                notif.sentCount = sent;
                notif.failedCount = failed;
                notif.status = failed === studentsWithEmail.length ? 'failed' : 'completed';
                await notif.save();
            }
        } catch (error: any) {
            console.error(`Notification job failed: ${error.message}`);
            notif.status = 'failed';
            await notif.save();
            throw error;
        }
    }, { connection });

    // 2. Fee Generation Worker
    const feeWorker = new Worker('feeGenerationQueue', async (job: Job<FeeGenerationJobData>) => {
        const { schoolId, className, month, dueDate } = job.data;
        try {
            await FeeService.generateMonthlyFees(schoolId, className, month, new Date(dueDate));
            console.log(`Background fee generation for ${className} ${month} completed`);
        } catch (error: any) {
            console.error(`Fee generation job failed: ${error.message}`);
            throw error;
        }
    }, { connection });

    // 3. Salary Generation Worker
    const SalaryService = (await import('../services/salary.service')).default;
    const salaryWorker = new Worker('salaryGenerationQueue', async (job: Job<SalaryGenerationJobData>) => {
        const { schoolId, month, year, specificStaffId } = job.data;
        try {
            const result = await SalaryService.generateMonthlySalaries(schoolId, month, year, specificStaffId);
            console.log(`Background salary generation for ${month}-${year}: created=${result.created} updated=${result.updated}`);
        } catch (error: any) {
            console.error(`Salary generation job failed: ${error.message}`);
            throw error;
        }
    }, { connection, concurrency: 1 }); // concurrency=1: one school's payroll at a time to avoid DB lock contention

    notificationWorker.on('failed', (job, err) => {
        console.error(`Notification Job ${job?.id} failed: ${err.message}`);
    });
    
    feeWorker.on('failed', (job, err) => {
        console.error(`Fee Generation Job ${job?.id} failed: ${err.message}`);
    });

    salaryWorker.on('failed', (job, err) => {
        console.error(`Salary Generation Job ${job?.id} failed: ${err.message}`);
    });

    console.log('Background Queue Workers started successfully (notification, fee, salary)');
}
