import { google } from 'googleapis';

const SCOPES = ['https://www.googleapis.com/auth/gmail.send'];

function getOAuthClient() {
    const id = process.env.GOOGLE_CLIENT_ID;
    const secret = process.env.GOOGLE_CLIENT_SECRET;
    const redirect = process.env.GOOGLE_REDIRECT_URI;
    if (!id || !secret || !redirect) throw new Error('Google OAuth not configured');
    return new google.auth.OAuth2(id, secret, redirect);
}

export function isGmailConfigured(): boolean {
    return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REDIRECT_URI);
}

export function getAuthUrl(): string {
    const oAuth2 = getOAuthClient();
    return oAuth2.generateAuthUrl({ access_type: 'offline', scope: SCOPES, prompt: 'consent' });
}

export async function getTokensFromCode(code: string) {
    const oAuth2 = getOAuthClient();
    const { tokens } = await oAuth2.getToken(code);
    return tokens;
}

export interface EmailSendResult {
    email: string;
    success: boolean;
    error?: string;
}

/**
 * Send email using stored OAuth tokens. Processes in batches.
 */
export async function sendBulkEmail(
    tokens: { access_token: string; refresh_token?: string },
    recipients: { email: string; name?: string }[],
    subject: string,
    htmlBody: string
): Promise<{ sent: number; failed: number; results: EmailSendResult[] }> {
    const oAuth2 = getOAuthClient();
    oAuth2.setCredentials(tokens);
    const gmail = google.gmail({ version: 'v1', auth: oAuth2 });

    const results: EmailSendResult[] = [];
    let sent = 0, failed = 0;
    const BATCH = 5;

    for (let i = 0; i < recipients.length; i += BATCH) {
        const batch = recipients.slice(i, i + BATCH);
        const promises = batch.map(async (r) => {
            try {
                const raw = makeRawEmail(r.email, subject, htmlBody, r.name);
                await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
                sent++;
                return { email: r.email, success: true };
            } catch (err: any) {
                failed++;
                return { email: r.email, success: false, error: err.message || 'Unknown error' };
            }
        });
        const batchResults = await Promise.all(promises);
        results.push(...batchResults);
    }

    return { sent, failed, results };
}

function makeRawEmail(to: string, subject: string, html: string, toName?: string): string {
    const toHeader = toName ? `"${toName}" <${to}>` : to;
    const raw = [
        `To: ${toHeader}`,
        `Subject: ${subject}`,
        'MIME-Version: 1.0',
        'Content-Type: text/html; charset=utf-8',
        '',
        html,
    ].join('\r\n');
    return Buffer.from(raw).toString('base64url');
}
