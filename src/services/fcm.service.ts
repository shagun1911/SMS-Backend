import admin from 'firebase-admin';
import config from '../config';
import User from '../models/user.model';
import Student from '../models/student.model';

const INVALID_TOKEN_CODES = new Set([
    'messaging/invalid-registration-token',
    'messaging/registration-token-not-registered',
]);

let initialized = false;

function getMessaging(): admin.messaging.Messaging | null {
    const json = config.firebase?.serviceAccountJson;
    if (!json) return null;
    if (!initialized) {
        try {
            const cred = JSON.parse(json) as admin.ServiceAccount;
            if (!admin.apps.length) {
                admin.initializeApp({ credential: admin.credential.cert(cred) });
            }
            initialized = true;
        } catch (error: any) {
            console.error(`Firebase/FCM initialization failed: ${error.message}. Notifications will be disabled.`);
            return null;
        }
    }
    return admin.messaging();
}

async function removeDeadTokens(tokens: string[]): Promise<void> {
    if (tokens.length === 0) return;
    await Promise.all([
        User.updateMany({ fcmTokens: { $in: tokens } }, { $pull: { fcmTokens: { $in: tokens } } }),
        Student.updateMany({ fcmTokens: { $in: tokens } }, { $pull: { fcmTokens: { $in: tokens } } }),
    ]);
}

async function sendToTokens(tokens: string[], title: string, body: string): Promise<void> {
    const messaging = getMessaging();
    if (!messaging || tokens.length === 0) return;

    const unique = [...new Set(tokens.filter((t) => typeof t === 'string' && t.length > 0))];
    if (unique.length === 0) return;

    const res = await messaging.sendEachForMulticast({
        tokens: unique,
        notification: { title, body },
    });

    const dead: string[] = [];
    res.responses.forEach((r, i) => {
        if (r.success) return;
        const code = r.error?.code;
        if (code && INVALID_TOKEN_CODES.has(code)) dead.push(unique[i]);
    });
    await removeDeadTokens(dead);
}

/** Single staff user (same `User` id as JWT). */
export async function sendNotification(userId: string, title: string, body: string): Promise<void> {
    await sendNotificationToStaffUsers([userId], title, body);
}

/** Push to school staff `User` document ids (same collection as login). */
export async function sendNotificationToStaffUsers(
    userIds: string[],
    title: string,
    body: string
): Promise<void> {
    if (!getMessaging() || userIds.length === 0) return;
    const users = await User.find({ _id: { $in: userIds } })
        .select('fcmTokens')
        .lean();
    const tokens = users.flatMap((u) => u.fcmTokens || []);
    await sendToTokens(tokens, title, body);
}

/** Push to `Student` document ids. */
export async function sendNotificationToStudents(
    studentIds: string[],
    title: string,
    body: string
): Promise<void> {
    if (!getMessaging() || studentIds.length === 0) return;
    const students = await Student.find({ _id: { $in: studentIds } })
        .select('fcmTokens')
        .lean();
    const tokens = students.flatMap((s) => s.fcmTokens || []);
    await sendToTokens(tokens, title, body);
}
