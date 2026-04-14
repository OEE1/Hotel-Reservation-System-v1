/**
 * 按 env 懒建单例：显式 `REDIS_DRIVER` 或自动识别 Upstash / `REDIS_URL`。
 */
import { createIoredisRateLimit } from "@/lib/redis/ioredisRateLimit";
import type { RateLimitRedis } from "@/lib/redis/rateLimitRedis";
import { createUpstashRateLimit } from "@/lib/redis/upstashRateLimit";

let cached: RateLimitRedis | null | undefined;

export function getRateLimitRedis(): RateLimitRedis | null {
  if (cached !== undefined) return cached;

  const driver = process.env.REDIS_DRIVER?.toLowerCase();
  const upUrl = process.env.UPSTASH_REDIS_REST_URL;
  const upToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  const redisUrl = process.env.REDIS_URL;

  if (driver === "upstash") {
    if (!upUrl || !upToken) {
      cached = null;
      return cached;
    }
    cached = createUpstashRateLimit(upUrl, upToken);
    return cached;
  }

  if (driver === "ioredis") {
    if (!redisUrl) {
      cached = null;
      return cached;
    }
    cached = createIoredisRateLimit(redisUrl);
    return cached;
  }

  if (upUrl && upToken) {
    cached = createUpstashRateLimit(upUrl, upToken);
    return cached;
  }

  if (redisUrl) {
    cached = createIoredisRateLimit(redisUrl);
    return cached;
  }

  cached = null;
  return cached;
}

/** 测试或热重载时清空缓存（一般无需调用） */
export function resetRateLimitRedisCache(): void {
  cached = undefined;
}
