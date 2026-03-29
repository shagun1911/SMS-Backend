import mongoose from 'mongoose';
import ErrorResponse from '../utils/errorResponse';
import School from '../models/school.model';
import Student from '../models/student.model';
import User from '../models/user.model';
import StudentFee from '../models/studentFee.model';
import FeePayment from '../models/feePayment.model';
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
import { updateUsageForSchool } from './usage.service';

class CascadeDeleteService {
    async deleteStudentCascade(schoolId: string, studentId: string): Promise<void> {
        const session = await mongoose.startSession();
        try {
            await session.withTransaction(async () => {
                const student = await Student.findOne({ _id: studentId, schoolId }).session(session);
                if (!student) throw new ErrorResponse('Student not found', 404);

                await Promise.all([
                    StudentFee.deleteMany({ schoolId, studentId }).session(session),
                    FeePayment.deleteMany({ schoolId, studentId }).session(session),
                    ExamResult.deleteMany({ schoolId, studentId }).session(session),
                    Student.deleteOne({ _id: studentId, schoolId }).session(session),
                ]);
            });
        } finally {
            session.endSession();
        }

        await updateUsageForSchool(schoolId);
    }

    async deleteStaffCascade(schoolId: string, staffId: string): Promise<void> {
        const session = await mongoose.startSession();
        try {
            await session.withTransaction(async () => {
                const staff = await User.findOne({ _id: staffId, schoolId }).session(session);
                if (!staff) throw new ErrorResponse('Staff not found', 404);

                await Promise.all([
                    Salary.deleteMany({ schoolId, staffId }).session(session),
                    SalaryStructure.deleteMany({ schoolId, staffId }).session(session),
                    OtherPayment.deleteMany({ schoolId, staffId }).session(session),
                    Homework.deleteMany({ schoolId, createdBy: staffId }).session(session),
                    Notification.deleteMany({ schoolId, createdBy: staffId }).session(session),
                    UserNotification.deleteMany({ schoolId, userId: staffId }).session(session),
                    Class.updateMany({ schoolId, classTeacherId: staffId }, { $unset: { classTeacherId: 1 } }).session(session),
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
                    User.deleteOne({ _id: staffId, schoolId }).session(session),
                ]);
            });
        } finally {
            session.endSession();
        }

        await updateUsageForSchool(schoolId);
    }

    async deleteSchoolCascade(schoolId: string): Promise<void> {
        const session = await mongoose.startSession();
        try {
            await session.withTransaction(async () => {
                const school = await School.findById(schoolId).session(session);
                if (!school) throw new ErrorResponse('School not found', 404);

                await Promise.all([
                    // Student domain
                    StudentFee.deleteMany({ schoolId }).session(session),
                    FeePayment.deleteMany({ schoolId }).session(session),
                    ExamResult.deleteMany({ schoolId }).session(session),
                    Student.deleteMany({ schoolId }).session(session),

                    // Staff domain
                    Salary.deleteMany({ schoolId }).session(session),
                    SalaryStructure.deleteMany({ schoolId }).session(session),
                    OtherPayment.deleteMany({ schoolId }).session(session),
                    User.deleteMany({ schoolId }).session(session),

                    // Academic structure
                    Class.deleteMany({ schoolId }).session(session),
                    SessionModel.deleteMany({ schoolId }).session(session),
                    Exam.deleteMany({ schoolId }).session(session),
                    Homework.deleteMany({ schoolId }).session(session),

                    // Transport
                    Bus.deleteMany({ schoolId }).session(session),

                    // Finance
                    FeeStructure.deleteMany({ schoolId }).session(session),

                    // Timetable + aux
                    Timetable.deleteMany({ schoolId }).session(session),
                    TimetableVersion.deleteMany({ schoolId }).session(session),
                    TimetableSettings.deleteMany({ schoolId }).session(session),
                    SchoolTimetableGrid.deleteMany({ schoolId }).session(session),

                    // Communication + support
                    Notification.deleteMany({ schoolId }).session(session),
                    UserNotification.deleteMany({ schoolId }).session(session),
                    SupportTicket.deleteMany({ schoolId }).session(session),

                    // Subscription + usage
                    SchoolSubscription.deleteMany({ schoolId }).session(session),
                    Usage.deleteMany({ schoolId }).session(session),

                    // Parent school record
                    School.deleteOne({ _id: schoolId }).session(session),
                ]);
            });
        } finally {
            session.endSession();
        }
    }
}

export default new CascadeDeleteService();
