import config from '../config';

const PHONEPE_TOKEN_URL = {
    sandbox: 'https://api-preprod.phonepe.com/apis/pg-sandbox/v1/oauth/token',
    production: 'https://api.phonepe.com/apis/identity-manager/v1/oauth/token',
};
const PHONEPE_PAY_URL = {
    sandbox: 'https://api-preprod.phonepe.com/apis/pg-sandbox/checkout/v2/pay',
    production: 'https://api.phonepe.com/apis/pg/checkout/v2/pay',
};

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

export function isPhonePeConfigured(): boolean {
    return !!(config.phonepe.clientId && config.phonepe.clientSecret);
}
