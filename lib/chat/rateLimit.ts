/**
 * M5：Redis Lua 滑动窗口限流；先 user 后 IP（4C）；Redis 不可用默认 fail-open（3A）。
 */
import { createHash } from "crypto";
import type { NextRequest } from "next/server";
import { getRateLimitConfig } from "@/lib/chat/limits";
import { chatLog } from "@/lib/observability/chatLog";
import { getRateLimitRedis } from "@/lib/redis/getRateLimitRedis";
import type { RateLimitRedis } from "@/lib/redis/rateLimitRedis";

export type RateLimitDeniedCode = "RATE_LIMIT_USER" | "RATE_LIMIT_IP";

/** 命中限流，供 route 映射 429 + Retry-After */
export class ChatRateLimitError extends Error {
  readonly code: RateLimitDeniedCode;
  readonly retryAfterMs: number;

  constructor(code: RateLimitDeniedCode, retryAfterMs: number) {
    super(code);
    this.name = "ChatRateLimitError";
    this.code = code;
    this.retryAfterMs = retryAfterMs;
  }
}

/** strict 模式或 Redis 不可用时拒绝服务，供 route 映射 503 */
export class ChatRateLimitRedisError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChatRateLimitRedisError";
  }
}

/** ZSET 滑动窗口：移除 score<=now-window，未超限则 ZADD；超限返回 {0,retryAfterMs} */
const LUA_SLIDING_WINDOW = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local member = ARGV[4]
redis.call('ZREMRANGEBYSCORE', key, '-inf', tostring(now - windowMs))
local cnt = redis.call('ZCARD', key)
if cnt >= limit then
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  if oldest[2] == nil then
    return {0, 1000}
  end
  local oldestScore = tonumber(oldest[2])
  local retryAfter = oldestScore + windowMs - now
  if retryAfter < 1 then retryAfter = 1 end
  return {0, retryAfter}
end
redis.call('ZADD', key, now, member)
redis.call('PEXPIRE', key, windowMs + 1000)
return {1, 0}
`;

function parseEvalResult(raw: unknown): { ok: boolean; retryAfterMs: number } {
  if (!Array.isArray(raw) || raw.length < 2) {
    throw new Error("rate_limit:bad_lua_result");
  }
  const ok = Number(raw[0]) === 1;
  const retryAfter = Number(raw[1]);
  if (ok) return { ok: true, retryAfterMs: 0 };
  return { ok: false, retryAfterMs: Math.max(1, Math.ceil(retryAfter)) };
}

export function resolveClientIp(req: NextRequest, trustProxy: boolean): string {
  if (trustProxy) {
    const xff = req.headers.get("x-forwarded-for");
    if (xff) {
      const first = xff.split(",")[0]?.trim();
      if (first) return first;
    }
  }
  const real =
    req.headers.get("x-real-ip") || req.headers.get("cf-connecting-ip");
  if (real) return real.trim();
  return "unknown";
}

export function hashIp(ip: string): string {
  return createHash("sha256").update(ip).digest("hex").slice(0, 16);
}

async function consumeSlot(
  redis: RateLimitRedis,
  key: string,
  member: string,
  windowMs: number,
  limit: number,
): Promise<{ ok: boolean; retryAfterMs: number }> {
  const now = Date.now();
  const raw = await redis.eval(LUA_SLIDING_WINDOW, [key], [
    now,
    windowMs,
    limit,
    member,
  ]);
  return parseEvalResult(raw);
}

/**
 * Redis 不可用时：非 strict 直接返回；strict 抛 ChatRateLimitRedisError。
 * 命中限流抛 ChatRateLimitError。
 */
export async function assertChatRateLimit(
  req: NextRequest,
  guestId: string,
): Promise<void> {
  const cfg = getRateLimitConfig();
  const redis = getRateLimitRedis();

  if (!redis) {
    if (cfg.strict) {
      chatLog("error", "redis_unavail", {
        reason: "no_client",
        guestId,
        code: "REDIS_UNAVAILABLE",
      });
      throw new ChatRateLimitRedisError("Redis not configured");
    }
    chatLog("warn", "redis_unavail", {
      reason: "no_client",
      guestId,
    });
    return;
  }

  const ip = resolveClientIp(req, cfg.trustProxy);
  const ipHash = hashIp(ip);
  const member = `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;

  try {
    const userKey = `ratelimit:user:${guestId}`;
    const u = await consumeSlot(redis, userKey, member, cfg.windowMs, cfg.userMax);
    if (!u.ok) {
      chatLog("info", "rate_limit", {
        code: "RATE_LIMIT_USER",
        guestId,
        reason: "user_bucket",
        retryAfterMs: u.retryAfterMs,
      });
      throw new ChatRateLimitError("RATE_LIMIT_USER", u.retryAfterMs);
    }

    const ipKey = `ratelimit:ip:${ipHash}`;
    const p = await consumeSlot(redis, ipKey, member, cfg.windowMs, cfg.ipMax);
    if (!p.ok) {
      chatLog("info", "rate_limit", {
        code: "RATE_LIMIT_IP",
        guestId,
        reason: "ip_bucket",
        retryAfterMs: p.retryAfterMs,
      });
      throw new ChatRateLimitError("RATE_LIMIT_IP", p.retryAfterMs);
    }
  } catch (e) {
    if (e instanceof ChatRateLimitError) throw e;
    if (e instanceof ChatRateLimitRedisError) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    if (cfg.strict) {
      chatLog("error", "redis_unavail", {
        reason: "eval_failed",
        guestId,
        code: msg.slice(0, 200),
      });
      throw new ChatRateLimitRedisError("Redis rate limit error");
    }
    chatLog("warn", "redis_unavail", {
      reason: "eval_failed",
      guestId,
      code: msg.slice(0, 200),
    });
  }
}
