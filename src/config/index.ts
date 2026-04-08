import dotenv from 'dotenv';

dotenv.config();

interface IConfig {
    env: string;
    port: number;
    mongodb: {
        uri: string;
    };
    jwt: {
        accessSecret: string;
        refreshSecret: string;
        accessExpire: string;
        refreshExpire: string;
    };
    cloudinary: {
        cloudName: string;
        apiKey: string;
        apiSecret: string;
        /** True when at least one full account exists in env (used for homework / file uploads). */
        isConfigured: boolean;
        /** Multiple accounts (e.g. CLOUDINARY_2_CLOUD_NAME, CLOUDINARY_2_API_KEY, CLOUDINARY_2_API_SECRET). Tried in order when one is full. */
        accounts: Array<{ cloudName: string; apiKey: string; apiSecret: string }>;
    };
    frontend: {
        url: string;
        /** Comma-separated origins for CORS (defaults to url if not set) */
        origins?: string[];
    };
    rateLimit: {
        windowMs: number;
        maxRequests: number;
    };
    upload: {
        maxFileSize: number;
    };
    gemini: {
        apiKey: string;
        model: string;
    };
    groq: {
        apiKey: string;
        model: string;
    };
    razorpay: {
        keyId: string;
        keySecret: string;
        webhookSecret: string;
        successPath: string;
        cancelPath: string;
    };
    phonepe: {
        clientId: string;
        clientSecret: string;
        clientVersion: string;
        env: 'sandbox' | 'production';
        webhookUsername: string;
        webhookPassword: string;
        successPath: string;
    };
    /** Firebase Admin: paste full service account JSON as a single line in env (optional). */
    firebase?: {
        serviceAccountJson?: string;
    };
}

const config: IConfig = {
    env: process.env.NODE_ENV || 'development',
    port: parseInt(process.env.PORT || '5001', 10),
    mongodb: {
        uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/ssms-db',
    },
    jwt: {
        accessSecret: process.env.JWT_ACCESS_SECRET || 'access-secret-key',
        refreshSecret: process.env.JWT_REFRESH_SECRET || 'refresh-secret-key',
        accessExpire: process.env.JWT_ACCESS_EXPIRE || '15m',
        refreshExpire: process.env.JWT_REFRESH_EXPIRE || '7d',
    },
    cloudinary: (() => {
        const accounts: Array<{ cloudName: string; apiKey: string; apiSecret: string }> = [];
        const c1 = process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET;
        if (c1) {
            accounts.push({
                cloudName: process.env.CLOUDINARY_CLOUD_NAME!,
                apiKey: process.env.CLOUDINARY_API_KEY!,
                apiSecret: process.env.CLOUDINARY_API_SECRET!,
            });
        }
        for (let i = 2; i <= 10; i++) {
            const name = process.env[`CLOUDINARY_${i}_CLOUD_NAME`];
            const key = process.env[`CLOUDINARY_${i}_API_KEY`];
            const secret = process.env[`CLOUDINARY_${i}_API_SECRET`];
            if (name && key && secret) accounts.push({ cloudName: name, apiKey: key, apiSecret: secret });
        }
        return {
            cloudName: process.env.CLOUDINARY_CLOUD_NAME || '',
            apiKey: process.env.CLOUDINARY_API_KEY || '',
            apiSecret: process.env.CLOUDINARY_API_SECRET || '',
            accounts,
            isConfigured: accounts.length > 0,
        };
    })(),
    frontend: (() => {
        const url = process.env.FRONTEND_URL || 'http://localhost:3000';
        // In dev, allow both 3000 and 3001 unless CORS_ORIGINS is explicitly set
        const defaultOrigins = 'http://localhost:3000,http://localhost:3001';
        const originsStr = process.env.CORS_ORIGINS ?? (process.env.NODE_ENV === 'production' ? process.env.FRONTEND_URL || url : defaultOrigins);
        const origins = originsStr.split(',').map((o) => o.trim()).filter(Boolean);
        if (!origins.includes(url)) origins.unshift(url);
        return { url, origins };
    })(),
    rateLimit: {
        windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10),
        maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10),
    },
    upload: {
        maxFileSize: parseInt(process.env.MAX_FILE_SIZE || '5242880', 10),
    },
    gemini: {
        apiKey: process.env.GEMINI_API_KEY || '',
        model: process.env.GEMINI_MODEL || 'gemini-3-flash-preview',
    },
    groq: {
        apiKey: process.env.GROQ_API_KEY || '',
        model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
    },
    razorpay: {
        keyId: process.env.RAZORPAY_KEY_ID || '',
        keySecret: process.env.RAZORPAY_KEY_SECRET || '',
        webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET || '',
        successPath: process.env.RAZORPAY_SUCCESS_PATH || '/plan',
        cancelPath: process.env.RAZORPAY_CANCEL_PATH || '/plan',
    },
    phonepe: {
        clientId: process.env.PHONEPE_CLIENT_ID || '',
        clientSecret: process.env.PHONEPE_CLIENT_SECRET || '',
        clientVersion: process.env.PHONEPE_CLIENT_VERSION || '1.0',
        env: (process.env.PHONEPE_ENV === 'production' ? 'production' : 'sandbox') as 'sandbox' | 'production',
        webhookUsername: process.env.PHONEPE_WEBHOOK_USERNAME || '',
        webhookPassword: process.env.PHONEPE_WEBHOOK_PASSWORD || '',
        successPath: process.env.PHONEPE_SUCCESS_PATH || '/plan',
    },
    firebase: (() => {
        const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
        return raw ? { serviceAccountJson: raw } : undefined;
    })(),
};

export default config;
