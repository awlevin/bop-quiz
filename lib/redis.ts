import Redis from 'ioredis';

// On globalThis so dev-server module reloads reuse the connection.
const holder = globalThis as typeof globalThis & { __bopQuizRedis?: Redis | null };

export function redisUrl(): string | undefined {
  return process.env.REDIS_URL ?? process.env.KV_URL;
}

/** The shared command connection, or null when no Redis is configured (local dev). */
export function getRedis(): Redis | null {
  if (holder.__bopQuizRedis === undefined) {
    const url = redisUrl();
    if (!url) {
      if (process.env.VERCEL) throw new Error('REDIS_URL is not set.');
      holder.__bopQuizRedis = null;
    } else {
      const redis = new Redis(url, { maxRetriesPerRequest: 2, enableReadyCheck: false });
      redis.on('error', (err) => console.error('[redis]', err.message));
      holder.__bopQuizRedis = redis;
    }
  }
  return holder.__bopQuizRedis;
}
