type CacheEntry<T> = { value: T; expiresAt: number };

/**
 * Simple in-memory TTL cache.
 *
 * Production notes:
 * - This is per-process. With horizontal scaling, each instance has its own cache.
 * - Keep TTLs short; do not store sensitive data.
 */
class TTLCache {
    private store = new Map<string, CacheEntry<any>>();

    get<T>(key: string): T | undefined {
        const entry = this.store.get(key);
        if (!entry) return undefined;
        if (Date.now() > entry.expiresAt) {
            this.store.delete(key);
            return undefined;
        }
        return entry.value as T;
    }

    set<T>(key: string, value: T, ttlMs: number): void {
        const ttl = Math.max(250, Math.floor(ttlMs || 0));
        this.store.set(key, { value, expiresAt: Date.now() + ttl });
    }

    del(key: string): void {
        this.store.delete(key);
    }

    delPrefix(prefix: string): void {
        for (const k of this.store.keys()) {
            if (k.startsWith(prefix)) this.store.delete(k);
        }
    }

    async getOrSet<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
        const hit = this.get<T>(key);
        if (hit !== undefined) return hit;
        const value = await fn();
        this.set(key, value, ttlMs);
        return value;
    }
}

export const cache = new TTLCache();

