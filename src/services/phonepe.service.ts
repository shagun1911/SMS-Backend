import crypto from 'crypto';
import config from '../config';

const PHONEPE_TOKEN_URL = {
    sandbox: 'https://api-preprod.phonepe.com/apis/pg-sandbox/v1/oauth/token',
    production: 'https://api.phonepe.com/apis/identity-manager/v1/oauth/token',
};
const PHONEPE_PAY_URL = {
    sandbox: 'https://api-preprod.phonepe.com/apis/pg-sandbox/checkout/v2/pay',
    production: 'https://api.phonepe.com/apis/pg/checkout/v2/pay',
};
const PHONEPE_QR_URL = {
    sandbox: 'https://api-preprod.phonepe.com/apis/pg-sandbox/pg/v1/pay',
    production: 'https://api.phonepe.com/apis/pg/v1/pay',
};
const PHONEPE_STATUS_URL = {
    sandbox: 'https://api-preprod.phonepe.com/apis/pg-sandbox/pg/v1/status',
    production: 'https://api.phonepe.com/apis/pg/v1/status',
};

/**
 * Generate X-VERIFY checksum for PhonePe Business APIs.
 */
function generateXVerify(payload: any, endpoint: string): string {
    const { clientSecret } = config.phonepe;
    const saltIndex = '1'; // Default index

    // Some secrets are base64 encoded UUIDs
    let saltKey = clientSecret;
    try {
        if (clientSecret.length > 30 && !clientSecret.includes('-')) {
            const decoded = Buffer.from(clientSecret, 'base64').toString();
            if (decoded.includes('-')) saltKey = decoded;
        }
    } catch (e) { }

    const base64Payload = Buffer.from(JSON.stringify(payload)).toString('base64');
    const stringToHash = base64Payload + endpoint + saltKey;
    const sha256 = crypto.createHash('sha256').update(stringToHash).digest('hex');
    return `${sha256}###${saltIndex}`;
}

let cachedToken: string | null = null;
let cachedExpiresAt: number = 0;

/**
 * Get O-Bearer token; cached until ~5 min before expiry.
 */
export async function getPhonePeToken(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    if (cachedToken && cachedExpiresAt > now + 300) return cachedToken;

    const { clientId, clientSecret, clientVersion, env } = config.phonepe;
    if (!clientId || !clientSecret) throw new Error('PhonePe client_id and client_secret required');

    const body = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        client_version: clientVersion || '1',
        grant_type: 'client_credentials',
    });
    const res = await fetch(PHONEPE_TOKEN_URL[env], {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`PhonePe token failed: ${res.status} ${text}`);
    }
    const data = (await res.json()) as { access_token?: string; expires_at?: number };
    if (!data.access_token) throw new Error('PhonePe token response missing access_token');
    cachedToken = data.access_token;
    cachedExpiresAt = data.expires_at ?? now + 3600;
    return cachedToken;
}

export interface CreatePaymentParams {
    merchantOrderId: string;
    amountPaisa: number;
    redirectUrl: string;
    metaInfo?: { udf1?: string; udf2?: string; udf3?: string };
    expireAfter?: number;
}

export interface CreatePaymentResult {
    redirectUrl: string;
    orderId: string;
    state: string;
}

/**
 * Create PhonePe checkout session; returns redirectUrl for frontend.
 */
export async function createPhonePePayment(params: CreatePaymentParams): Promise<CreatePaymentResult> {
    const token = await getPhonePeToken();
    const { env } = config.phonepe;
    const body = {
        merchantOrderId: params.merchantOrderId,
        amount: params.amountPaisa,
        expireAfter: params.expireAfter ?? 1200,
        paymentFlow: {
            type: 'PG_CHECKOUT',
            merchantUrls: { redirectUrl: params.redirectUrl },
        },
        ...(params.metaInfo && Object.keys(params.metaInfo).length > 0 ? { metaInfo: params.metaInfo } : {}),
    };
    const res = await fetch(PHONEPE_PAY_URL[env], {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `O-Bearer ${token}`,
        },
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`PhonePe create payment failed: ${res.status} ${text}`);
    }
    const data = (await res.json()) as { redirectUrl?: string; orderId?: string; state?: string };
    if (!data.redirectUrl) throw new Error('PhonePe response missing redirectUrl');
    return {
        redirectUrl: data.redirectUrl,
        orderId: data.orderId ?? '',
        state: data.state ?? 'PENDING',
    };
}

/**
 * Create PhonePe Dynamic QR Code.
 */
export async function createPhonePeQrCode(params: {
    merchantOrderId: string;
    amountPaisa: number;
    metaInfo?: any;
}): Promise<{ qrData: string; merchantTransactionId: string }> {
    const { env, clientId } = config.phonepe;
    const endpoint = '/pg/v1/pay';

    const payload = {
        merchantId: clientId,
        merchantTransactionId: params.merchantOrderId,
        merchantUserId: 'MUID' + clientId.slice(-6),
        amount: params.amountPaisa,
        paymentInstrument: {
            type: 'PI_QR_CODE',
        },
        mobileNumber: '9999999999',
        callbackUrl: 'https://webhook.site/dummy', // Should be an actual webhook
        ...(params.metaInfo ? { metaInfo: params.metaInfo } : {}),
    };

    const base64Payload = Buffer.from(JSON.stringify(payload)).toString('base64');
    const xVerify = generateXVerify(payload, endpoint);

    const res = await fetch(PHONEPE_QR_URL[env], {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-VERIFY': xVerify,
        },
        body: JSON.stringify({ request: base64Payload }),
    });

    if (!res.ok) {
        const text = await res.text();
        console.error('PhonePe QR error:', res.status, text);
        // Fallback or retry with O-Bearer if this fails? No, let's stick to X-VERIFY for PI_QR_CODE
        throw new Error(`PhonePe QR failed: ${res.status} ${text}`);
    }

    const data = await res.json() as any;
    console.log('PhonePe QR response:', data);

    if (data.success && data.data?.qrData) {
        return {
            qrData: data.data.qrData,
            merchantTransactionId: params.merchantOrderId,
        };
    }

    throw new Error(data.message || 'PhonePe QR response missing data');
}

/**
 * Check payment status via PhonePe API.
 */
export async function checkPaymentStatus(merchantTransactionId: string): Promise<{ state: string; amount?: number }> {
    const { env, clientId } = config.phonepe;
    const endpoint = `/pg/v1/status/${clientId}/${merchantTransactionId}`;

    const xVerify = generateXVerify('', endpoint); // Empty payload for GET status

    const url = `${PHONEPE_STATUS_URL[env]}/${clientId}/${merchantTransactionId}`;

    const res = await fetch(url, {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json',
            'X-VERIFY': xVerify,
            'X-MERCHANT-ID': clientId,
        },
    });

    if (!res.ok) {
        const text = await res.text();
        console.error('PhonePe status check error:', res.status, text);
        throw new Error(`PhonePe status check failed: ${res.status} ${text}`);
    }

    const data = await res.json() as any;
    return {
        state: data.data?.state ?? 'PENDING',
        amount: data.data?.amount,
    };
}

export function isPhonePeConfigured(): boolean {
    return !!(config.phonepe.clientId && config.phonepe.clientSecret);
}
