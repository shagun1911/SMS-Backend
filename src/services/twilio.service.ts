import Twilio from 'twilio';

let client: Twilio.Twilio | null = null;

function getClient(): Twilio.Twilio {
    if (!client) {
        const sid = process.env.TWILIO_ACCOUNT_SID;
        const token = process.env.TWILIO_AUTH_TOKEN;
        if (!sid || !token) throw new Error('Twilio credentials not configured');
        client = Twilio(sid, token);
    }
    return client;
}

function getFromNumber(): string {
    const num = process.env.TWILIO_PHONE_NUMBER;
    if (!num) throw new Error('TWILIO_PHONE_NUMBER not configured');
    return num;
}

export function isTwilioConfigured(): boolean {
    return !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_PHONE_NUMBER);
}

export interface SmsSendResult {
    phone: string;
    success: boolean;
    sid?: string;
    error?: string;
}

/**
 * Send SMS to a list of phone numbers. Returns per-recipient results.
 * Processes in batches of 10 to avoid rate limits.
 */
export async function sendBulkSms(
    phones: string[],
    message: string
): Promise<{ sent: number; failed: number; results: SmsSendResult[] }> {
    const tw = getClient();
    const from = getFromNumber();
    const results: SmsSendResult[] = [];
    let sent = 0, failed = 0;
    const BATCH = 10;

    for (let i = 0; i < phones.length; i += BATCH) {
        const batch = phones.slice(i, i + BATCH);
        const promises = batch.map(async (phone) => {
            const to = phone.startsWith('+') ? phone : `+91${phone.replace(/\D/g, '').slice(-10)}`;
            try {
                const msg = await tw.messages.create({ body: message, from, to });
                sent++;
                return { phone, success: true, sid: msg.sid };
            } catch (err: any) {
                failed++;
                return { phone, success: false, error: err.message || 'Unknown error' };
            }
        });
        const batchResults = await Promise.all(promises);
        results.push(...batchResults);
    }

    return { sent, failed, results };
}
