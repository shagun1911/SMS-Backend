import mongoose from 'mongoose';
import ErrorResponse from '../utils/errorResponse';
import School from '../models/school.model';
import Student from '../models/student.model';
import User from '../models/user.model';
import StudentFee from '../models/studentFee.model';
import FeePayment from '../models/feePayment.model';
import ReceiptCounter from '../models/receiptCounter.model';
import Exam from '../models/exam.model';
import ExamResult from '../models/examResult.model';
import Salary from '../models/salary.model';
import SalaryStructure from '../models/salaryStructure.model';
import OtherPayment from '../models/otherPayment.model';
import Class from '../models/class.model';
import Bus from '../models/bus.model';
import FeeStructure from '../models/feeStructure.model';
import SessionModel from '../models/session.model';
import Homework from '../models/homework.model';
import Notification from '../models/notification.model';
import UserNotification from '../models/userNotification.model';
import SupportTicket from '../models/supportTicket.model';
import Timetable from '../models/timetable.model';
import TimetableVersion from '../models/timetableVersion.model';
import TimetableSettings from '../models/timetableSettings.model';
import SchoolTimetableGrid from '../models/schoolTimetableGrid.model';
import SchoolSubscription from '../models/schoolSubscription.model';
import Usage from '../models/usage.model';
import AttendanceDay from '../models/attendanceDay.model';
import StudentNotification from '../models/studentNotification.model';
import { updateUsageForSchool } from './usage.service';
import { deleteFromCloudinary } from '../utils/cloudinary';
import { isLikelyCloudinaryAssetUrl, parseCloudinaryPublicIdFromUrl } from '../utils/cloudinaryUrl';
import { UserRole } from '../types';

async function deleteCloudinaryUrls(urls: (string | undefined | null)[]): Promise<void> {
    const unique = [...new Set(urls.filter(Boolean) as string[])];
    for (const url of unique) {
        if (!isLikelyCloudinaryAssetUrl(url)) continue;
        const publicId = parseCloudinaryPublicIdFromUrl(url);
        if (!publicId) continue;
        try {
            await deleteFromCloudinary(publicId);
        } catch (e) {
            console.error('[CascadeDelete] Cloudinary delete failed for', publicId, e);
        }
    }
}

async function stripStaffFromTimetables(
    session: mongoose.ClientSession,
    schoolId: string,
    staffObjectId: mongoose.Types.ObjectId
): Promise<void> {
    const timetables = await Timetable.find({ schoolId, 'slots.teacherId': staffObjectId }).session(session);
    for (const doc of timetables) {
        let dirty = false;
        for (const slot of doc.slots) {
            if (slot.teacherId && slot.teacherId.equals(staffObjectId)) {
                (slot as { teacherId?: mongoose.Types.ObjectId }).teacherId = undefined;
                dirty = true;
            }
        }
        if (dirty) {
            doc.markModified('slots');
            await doc.save({ session });
        }
    }

    const grids = await SchoolTimetableGrid.find({ schoolId }).session(session);
    for (const g of grids) {
        let dirty = false;
        for (const row of g.rows) {
            for (const cell of row.cells) {
                if (cell.teacherId && cell.teacherId.equals(staffObjectId)) {
                    (cell as { teacherId?: mongoose.Types.ObjectId }).teacherId = undefined;
                    dirty = true;
                }
            }
        }
        if (dirty) {
            g.markModified('rows');
            await g.save({ session });
        }
    }
}

function logDeletionAudit(kind: string, schoolId: string, detail: Record<string, unknown>): void {
    console.log(`[TenantDelete][${kind}] schoolId=${schoolId}`, JSON.stringify(detail));
}

class CascadeDeleteService {
    async deleteStudentCascade(schoolId: string, studentId: string): Promise<void> {
        const sid = new mongoose.Types.ObjectId(studentId);
        let photoUrl: string | undefined;

        const session = await mongoose.startSession();
        try {
            await session.withTransaction(async () => {
                const student = await Student.findOne({ _id: studentId, schoolId }).session(session);
                if (!student) throw new ErrorResponse('Student not found', 404);
                photoUrl = student.photo;

                await Promise.all([
                    StudentNotification.deleteMany({ schoolId, studentId: sid }).session(session),
                    StudentFee.deleteMany({ schoolId, studentId: sid }).session(session),
                    FeePayment.deleteMany({ schoolId, studentId: sid }).session(session),
                    ExamResult.deleteMany({ schoolId, studentId: sid }).session(session),
                ]);

                await AttendanceDay.updateMany({ schoolId }, { $pull: { absentStudentIds: sid } }).session(session);

                await Student.deleteOne({ _id: studentId, schoolId }).session(session);
            });
        } finally {
            session.endSession();
        }

        logDeletionAudit('student', schoolId, { studentId, cloudinaryUrls: photoUrl ? 1 : 0 });
        await deleteCloudinaryUrls([photoUrl]);
        await updateUsageForSchool(schoolId);
    }

    async deleteStaffCascade(schoolId: string, staffId: string): Promise<void> {
        const staffOid = new mongoose.Types.ObjectId(staffId);
        let photoUrl: string | undefined;

        const session = await mongoose.startSession();
        try {
            await session.withTransaction(async () => {
                const staff = await User.findOne({ _id: staffId, schoolId }).session(session);
                if (!staff) throw new ErrorResponse('Staff not found', 404);
                if (staff.role === UserRole.SUPER_ADMIN) {
                    throw new ErrorResponse('Cannot delete platform super admin via school cascade', 403);
                }
                photoUrl = staff.photo;

                await Promise.all([
                    Salary.deleteMany({ schoolId, staffId }).session(session),
                    SalaryStructure.deleteMany({ schoolId, staffId }).session(session),
                    OtherPayment.deleteMany({ schoolId, staffId }).session(session),
                    Homework.deleteMany({ schoolId, createdBy: staffId }).session(session),
                    Notification.deleteMany({ schoolId, createdBy: staffId }).session(session),
                    UserNotification.deleteMany({ schoolId, userId: staffId }).session(session),
                    Class.updateMany({ schoolId, classTeacherId: staffId }, { $unset: { classTeacherId: 1 } }).session(
                        session
                    ),
                    Bus.updateMany({ schoolId, driverId: staffId }, { $unset: { driverId: 1 } }).session(session),
                    Bus.updateMany(
                        { schoolId, driverUserId: staffId },
                        {
                            $unset: { driverUserId: 1 },
                            $set: { driverName: '', driverPhone: '' },
                        }
                    ).session(session),
                    Bus.updateMany(
                        { schoolId, conductorUserId: staffId },
                        {
                            $unset: { conductorUserId: 1 },
                            $set: { conductorName: '', conductorPhone: '' },
                        }
                    ).session(session),
                ]);

                await stripStaffFromTimetables(session, schoolId, staffOid);

                await User.deleteOne({ _id: staffId, schoolId }).session(session);
            });
        } finally {
            session.endSession();
        }

        logDeletionAudit('staff', schoolId, { staffId, cloudinaryUrls: photoUrl ? 1 : 0 });
        await deleteCloudinaryUrls([photoUrl]);
        await updateUsageForSchool(schoolId);
    }

    async deleteSchoolCascade(schoolId: string): Promise<void> {
        const urls: string[] = [];

        const session = await mongoose.startSession();
        try {
            await session.withTransaction(async () => {
                const school = await School.findById(schoolId).session(session);
                if (!school) throw new ErrorResponse('School not found', 404);

                const [students, users] = await Promise.all([
                    Student.find({ schoolId }).select('photo').session(session).lean(),
                    User.find({ schoolId }).select('photo').session(session).lean(),
                ]);
                const pushIfString = (u: unknown) => {
                    if (typeof u === 'string' && u.length > 0) urls.push(u);
                };
                for (const s of students) pushIfString(s.photo);
                for (const u of users) pushIfString(u.photo);
                pushIfString(school.logo);
                pushIfString((school as { stamp?: string }).stamp);
                pushIfString((school as { principalSignature?: string }).principalSignature);

                await Promise.all([
                    StudentNotification.deleteMany({ schoolId }).session(session),
                    AttendanceDay.deleteMany({ schoolId }).session(session),
                    StudentFee.deleteMany({ schoolId }).session(session),
                    FeePayment.deleteMany({ schoolId }).session(session),
                    ReceiptCounter.deleteMany({ schoolId }).session(session),
                    ExamResult.deleteMany({ schoolId }).session(session),
                    Student.deleteMany({ schoolId }).session(session),
                    Salary.deleteMany({ schoolId }).session(session),
                    SalaryStructure.deleteMany({ schoolId }).session(session),
                    OtherPayment.deleteMany({ schoolId }).session(session),
                    User.deleteMany({ schoolId }).session(session),
                    Class.deleteMany({ schoolId }).session(session),
                    SessionModel.deleteMany({ schoolId }).session(session),
                    Exam.deleteMany({ schoolId }).session(session),
                    Homework.deleteMany({ schoolId }).session(session),
                    Bus.deleteMany({ schoolId }).session(session),
                    FeeStructure.deleteMany({ schoolId }).session(session),
                    Timetable.deleteMany({ schoolId }).session(session),
                    TimetableVersion.deleteMany({ schoolId }).session(session),
                    TimetableSettings.deleteMany({ schoolId }).session(session),
                    SchoolTimetableGrid.deleteMany({ schoolId }).session(session),
                    Notification.deleteMany({ schoolId }).session(session),
                    UserNotification.deleteMany({ schoolId }).session(session),
                    SupportTicket.deleteMany({ schoolId }).session(session),
                    SchoolSubscription.deleteMany({ schoolId }).session(session),
                    Usage.deleteMany({ schoolId }).session(session),
                    School.deleteOne({ _id: schoolId }).session(session),
                ]);
            });
        } finally {
            session.endSession();
        }

        logDeletionAudit('school', schoolId, {
            cloudinaryCandidateUrls: urls.filter(Boolean).length,
        });
        await deleteCloudinaryUrls(urls);

        const sid = new mongoose.Types.ObjectId(schoolId);
        const orphans = {
            students: await Student.countDocuments({ schoolId: sid }),
            users: await User.countDocuments({ schoolId: sid }),
            attendanceDays: await AttendanceDay.countDocuments({ schoolId: sid }),
            studentNotifications: await StudentNotification.countDocuments({ schoolId: sid }),
        };
        const orphanTotal = Object.values(orphans).reduce((a, b) => a + b, 0);
        if (orphanTotal > 0) {
            console.warn('[CascadeDelete] Post school-delete orphan check failed:', schoolId, orphans);
        }
    }
}

export default new CascadeDeleteService();
