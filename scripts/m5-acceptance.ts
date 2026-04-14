/**
 * M5 限流验收脚本（项目根目录）：npx tsx scripts/m5-acceptance.ts
 * - 默认：无 Redis env 时 fail-open、strict 503 路径、ip/hash、getRateLimitConfig
 * - 可选：M5_LIVE_REDIS=1 且存在 REDIS_URL（或 Upstash 两变量）时对真实 Redis 做 429 探测
 */
import { NextRequest } from "next/server";
import { getRateLimitConfig, RATE_LIMIT_ENV_KEYS } from "../lib/chat/limits";
import {
  assertChatRateLimit,
  ChatRateLimitError,
  ChatRateLimitRedisError,
  hashIp,
  resolveClientIp,
} from "../lib/chat/rateLimit";
import { resetRateLimitRedisCache } from "../lib/redis/getRateLimitRedis";

const REDIS_KEYS = [
  "REDIS_DRIVER",
  "REDIS_URL",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
] as const;

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`[FAIL] ${msg}`);
}

let passed = 0;
function ok(name: string): void {
  passed += 1;
  console.log(`[OK] ${name}`);
}

function clearRedisEnv(): void {
  for (const k of REDIS_KEYS) delete process.env[k];
  resetRateLimitRedisCache();
}

async function run(): Promise<void> {
  const saved: Record<string, string | undefined> = {};
  for (const k of [...REDIS_KEYS, RATE_LIMIT_ENV_KEYS.STRICT]) {
    saved[k] = process.env[k];
  }

  try {
    clearRedisEnv();
    delete process.env[RATE_LIMIT_ENV_KEYS.WINDOW_MS];
    delete process.env[RATE_LIMIT_ENV_KEYS.USER_MAX];
    delete process.env[RATE_LIMIT_ENV_KEYS.IP_MAX];
    delete process.env[RATE_LIMIT_ENV_KEYS.TRUST_PROXY];

    const cfg = getRateLimitConfig();
    assert(cfg.windowMs === 60_000, "default window 60s");
    assert(cfg.userMax === 60, "default user max");
    assert(cfg.ipMax === 120, "default ip max");
    assert(cfg.trustProxy === false, "default trustProxy");
    assert(cfg.strict === false, "default strict");
    ok("M5 getRateLimitConfig defaults");

    const req = new NextRequest("http://localhost/api/chat", {
      headers: { "x-real-ip": "203.0.113.10" },
    });
    assert(resolveClientIp(req, false) === "203.0.113.10", "x-real-ip");
    assert(hashIp("test").length === 16, "hashIp length");
    ok("M5 resolveClientIp / hashIp");

    process.env[RATE_LIMIT_ENV_KEYS.STRICT] = "1";
    resetRateLimitRedisCache();
    try {
      await assertChatRateLimit(req, "guest-accept");
      throw new Error("expected ChatRateLimitRedisError");
    } catch (e) {
      assert(e instanceof ChatRateLimitRedisError, "strict no redis throws");
    }
    ok("M5 strict + no Redis → ChatRateLimitRedisError");

    delete process.env[RATE_LIMIT_ENV_KEYS.STRICT];
    resetRateLimitRedisCache();
    await assertChatRateLimit(req, "guest-accept");
    ok("M5 fail-open (no Redis, non-strict)");

    const live =
      process.env.M5_LIVE_REDIS === "1" &&
      (saved.REDIS_URL ||
        (saved.UPSTASH_REDIS_REST_URL && saved.UPSTASH_REDIS_REST_TOKEN));

    if (live) {
      clearRedisEnv();
      if (saved.REDIS_DRIVER) process.env.REDIS_DRIVER = saved.REDIS_DRIVER;
      if (saved.REDIS_URL) process.env.REDIS_URL = saved.REDIS_URL;
      if (saved.UPSTASH_REDIS_REST_URL)
        process.env.UPSTASH_REDIS_REST_URL = saved.UPSTASH_REDIS_REST_URL;
      if (saved.UPSTASH_REDIS_REST_TOKEN)
        process.env.UPSTASH_REDIS_REST_TOKEN = saved.UPSTASH_REDIS_REST_TOKEN;
      process.env[RATE_LIMIT_ENV_KEYS.USER_MAX] = "1";
      process.env[RATE_LIMIT_ENV_KEYS.WINDOW_MS] = "60000";
      process.env[RATE_LIMIT_ENV_KEYS.STRICT] = "0";
      resetRateLimitRedisCache();

      const r = new NextRequest("http://localhost/api/chat", {
        headers: { "x-real-ip": "198.51.100.1" },
      });
      await assertChatRateLimit(r, "live-guest-m5");
      try {
        await assertChatRateLimit(r, "live-guest-m5");
        throw new Error("expected ChatRateLimitError on 2nd call");
      } catch (e) {
        assert(
          e instanceof ChatRateLimitError && e.code === "RATE_LIMIT_USER",
          "429 user bucket",
        );
      }
      ok("M5 live Redis: 2nd request RATE_LIMIT_USER");
    } else {
      console.log(
        "[SKIP] live Redis test (set M5_LIVE_REDIS=1 and configure REDIS_URL or Upstash in .env.local)",
      );
    }

    console.log("");
    console.log(`All passed: ${passed} checks`);
  } finally {
    for (const k of [...REDIS_KEYS, RATE_LIMIT_ENV_KEYS.STRICT]) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    delete process.env[RATE_LIMIT_ENV_KEYS.USER_MAX];
    delete process.env[RATE_LIMIT_ENV_KEYS.WINDOW_MS];
    resetRateLimitRedisCache();
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
