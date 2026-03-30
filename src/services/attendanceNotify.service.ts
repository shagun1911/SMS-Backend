import mongoose from 'mongoose';
import StudentNotification from '../models/studentNotification.model';

/**
 * Fire-and-forget inserts for absent students (does not block HTTP response).
 */
export function scheduleAbsentStudentNotifications(
    schoolId: string,
    absentStudentIds: mongoose.Types.ObjectId[],
    dateYmd: string
): void {
    if (!absentStudentIds.length) return;

    const schoolOid = mongoose.Types.ObjectId.isValid(schoolId)
        ? new mongoose.Types.ObjectId(schoolId)
        : null;
    if (!schoolOid) return;

    setImmediate(() => {
        void (async () => {
            try {
                const docs = absentStudentIds.map((sid) => ({
                    studentId: sid,
                    schoolId: schoolOid,
                    title: 'Attendance',
                    message: 'You were marked absent today',
                    type: 'attendance_absent',
                    isRead: false,
                    metadata: { date: dateYmd },
                }));
                await StudentNotification.insertMany(docs, { ordered: false });
            } catch (err) {
                console.error('[attendance] student notifications failed', err);
            }
        })();
    });
}
