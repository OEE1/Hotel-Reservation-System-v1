/**
 * M8：会话存储专用 Redis 连接（可与 M5 限流共用实例，或 CHAT_SESSION_REDIS_URL 独立）。
 */
import Redis from "ioredis";
import { Redis as UpstashRedis } from "@upstash/redis";
import { SESSION_STORE_ENV_KEYS } from "@/lib/chat/limits";

export type SessionRedisHandle =
  | { kind: "ioredis"; client: Redis }
  | { kind: "upstash"; client: UpstashRedis };

let cached: SessionRedisHandle | null | undefined;

export function resetSessionRedisCache(): void {
  cached = undefined;
}

/**
 * 供 RedisStreamSessionStore 使用；无可用连接时返回 null（工厂可回退内存）。
 */
export function getSessionRedisForStore(): SessionRedisHandle | null {
  if (cached !== undefined) return cached;

  const dedicated = process.env[SESSION_STORE_ENV_KEYS.REDIS_URL]?.trim();
  if (dedicated) {
    cached = {
      kind: "ioredis",
      client: new Redis(dedicated, { maxRetriesPerRequest: 2, enableReadyCheck: true }),
    };
    return cached;
  }

  const driver = process.env.REDIS_DRIVER?.toLowerCase();
  const upUrl = process.env.UPSTASH_REDIS_REST_URL;
  const upToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  const redisUrl = process.env.REDIS_URL;

  if (driver === "upstash") {
    if (!upUrl || !upToken) {
      cached = null;
      return cached;
    }
    cached = { kind: "upstash", client: new UpstashRedis({ url: upUrl, token: upToken }) };
    return cached;
  }

  if (driver === "ioredis") {
    if (!redisUrl) {
      cached = null;
      return cached;
    }
    cached = {
      kind: "ioredis",
      client: new Redis(redisUrl, { maxRetriesPerRequest: 2, enableReadyCheck: true }),
    };
    return cached;
  }

  if (upUrl && upToken) {
    cached = { kind: "upstash", client: new UpstashRedis({ url: upUrl, token: upToken }) };
    return cached;
  }

  if (redisUrl) {
    cached = {
      kind: "ioredis",
      client: new Redis(redisUrl, { maxRetriesPerRequest: 2, enableReadyCheck: true }),
    };
    return cached;
  }

  cached = null;
  return cached;
}
