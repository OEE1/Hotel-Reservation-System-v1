# M5 限流实现总结

## 实现概述

按 [design-m5-rate-limit.md](./design-m5-rate-limit.md) 实现 **Redis Lua 滑动窗口**、**先 user 后 IP**、**无 Redis fail-open**（可选 strict → 503），并在 `POST /api/chat` 于 **鉴权之后、解析 body 之前** 调用 `assertChatRateLimit`。

## 涉及的文件

| 路径 | 作用 |
|------|------|
| `lib/redis/rateLimitRedis.ts` | `RateLimitRedis` 接口（`eval`） |
| `lib/redis/ioredisRateLimit.ts` | ioredis 适配 |
| `lib/redis/upstashRateLimit.ts` | @upstash/redis 适配 |
| `lib/redis/getRateLimitRedis.ts` | 按 env 懒建单例；`resetRateLimitRedisCache` 供测试 |
| `lib/chat/rateLimit.ts` | Lua 脚本、`assertChatRateLimit`、`resolveClientIp`、`hashIp`、`ChatRateLimitError`、`ChatRateLimitRedisError` |
| `lib/chat/limits.ts` | `RATE_LIMIT_ENV_KEYS`、`getRateLimitConfig()` |
| `lib/observability/chatLog.ts` | 事件 `redis_unavail`、`rate_limit`；字段 `retryAfterMs` |
| `app/api/chat/route.ts` | 串联 M5，映射 429/503 |
| `package.json` | 依赖 `ioredis`、`@upstash/redis` |

## 新增接口

- **`getRateLimitConfig(): RateLimitConfig`** — `windowMs`、`userMax`、`ipMax`、`trustProxy`、`strict`。
- **`assertChatRateLimit(req: NextRequest, guestId: string): Promise<void>`** — 成功无返回值；限流抛 **`ChatRateLimitError`**（`code`、`retryAfterMs`）；strict 且无 Redis 或 eval 失败抛 **`ChatRateLimitRedisError`**。
- **`getRateLimitRedis(): RateLimitRedis | null`** — 无配置返回 `null`（fail-open 路径）。

## 依赖关系

`route` → `assertChatRateLimit` → `getRateLimitRedis` + `getRateLimitConfig` → `chatLog`；Redis 实现仅用于 `eval(LUA)`。

## 决策记录

- **双客户端**：与设计 1C 一致；未设 `REDIS_DRIVER` 时优先 Upstash 变量，其次 `REDIS_URL`。
- **ZREMRANGEBYSCORE**：`'-inf'` 到 `now-windowMs`（含上界），移除窗口外成员。
- **429 Retry-After**：`ceil(retryAfterMs / 1000)`，最小 1 秒。

## 后续待办

- M10 串联 M3/M4 与限流顺序的最终对齐；集成测试双驱动 Redis。
