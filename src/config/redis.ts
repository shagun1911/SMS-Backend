import Redis, { RedisOptions } from 'ioredis';
import config from './index';

/**
 * Shared Redis configuration with proper retry strategy and error handling.
 * Used by both the app-level cache and BullMQ queue workers.
 */

const REDIS_BASE_OPTIONS: RedisOptions = {
    maxRetriesPerRequest: null,   // Required by BullMQ
    enableReadyCheck: false,      // Required by BullMQ
    lazyConnect: true,            // Don't connect until first command — app starts even if Redis is down
    retryStrategy(times: number) {
        if (times > 20) {
            console.error(`Redis: Giving up after ${times} retries. Will attempt reconnection later.`);
            return null; // Stop retrying (ioredis will emit 'end' and auto-reconnect after reconnectOnError)
        }
        const delay = Math.min(times * 200, 5000); // 200ms, 400ms, 600ms ... capped at 5s
        return delay;
    },
    reconnectOnError(err: Error) {
        // Reconnect on transient errors
        const code = (err as any).code;
        return code === 'ECONNRESET' || code === 'EPIPE' || code === 'ETIMEDOUT';
    },
};

const getRedisOptions = (url: string): RedisOptions => {
    const isSecure = url.startsWith('rediss://');
    return {
        ...REDIS_BASE_OPTIONS,
        // If the URL is rediss://, we must enable TLS
        tls: isSecure ? { rejectUnauthorized: false } : undefined,
    };
};

let redisClient: Redis | null = null;
let redisAvailable = false;

/**
 * Get (or create) the singleton Redis client.
 * Safe to call even if Redis is unavailable — will return the client
 * which will buffer commands and send them when reconnected.
 */
export const getRedisClient = (): Redis => {
    if (!redisClient) {
        redisClient = new Redis(config.redis.url, getRedisOptions(config.redis.url));

        redisClient.on('connect', () => {
            redisAvailable = true;
            console.log('🟢 Redis connected');
        });

        redisClient.on('ready', () => {
            redisAvailable = true;
        });

        redisClient.on('error', (error) => {
            // Suppress noisy transient errors — just log a short message
            const code = (error as any).code;
            if (code === 'ECONNRESET' || code === 'EPIPE' || code === 'ETIMEDOUT' || code === 'ECONNREFUSED') {
                if (redisAvailable) {
                    console.warn(`⚠️ Redis connection lost (${code}). Reconnecting...`);
                    redisAvailable = false;
                }
                return; // Don't spam the console
            }
            console.error(`Redis error: ${error.message}`);
        });

        redisClient.on('close', () => {
            redisAvailable = false;
        });

        // Initiate connection (lazy, so this just starts the process)
        redisClient.connect().catch(() => {
            // Swallow — the 'error' handler above will deal with it
        });
    }
    return redisClient;
};

/** Check if Redis is currently connected and responsive. */
export const isRedisAvailable = (): boolean => redisAvailable;

/**
 * Create a new Redis connection for BullMQ workers.
 * Each BullMQ Worker needs its own connection (cannot share with Queue).
 * Uses the same resilient config as the singleton.
 */
export const createBullMQConnection = (): Redis => {
    const conn = new Redis(config.redis.url, getRedisOptions(config.redis.url));

    conn.on('error', (error) => {
        const code = (error as any).code;
        if (code === 'ECONNRESET' || code === 'EPIPE' || code === 'ETIMEDOUT' || code === 'ECONNREFUSED') {
            return; // Suppress transient errors — BullMQ handles reconnection
        }
        console.error(`Redis (BullMQ worker) error: ${error.message}`);
    });

    conn.connect().catch(() => { /* handled by error event */ });

    return conn;
};

export default getRedisClient;
