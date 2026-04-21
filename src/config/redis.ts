import Redis from 'ioredis';
import config from './index';

let redisClient: Redis;

export const getRedisClient = (): Redis => {
    if (!redisClient) {
        redisClient = new Redis(config.redis.url, {
            maxRetriesPerRequest: null,
            enableReadyCheck: false,
        });

        redisClient.on('error', (error) => {
            console.error(`Redis connection error: ${error.message}`);
        });

        redisClient.on('connect', () => {
            console.log('Connected to Redis successfully');
        });
    }
    return redisClient;
};

export default getRedisClient;
