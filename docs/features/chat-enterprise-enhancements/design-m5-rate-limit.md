# 聊天增强 M5：限流（rateLimit）技术设计

**决策确认**：`1C` Redis 双驱动抽象 · `2A` Lua 真滑动窗口 · `3A` Redis 不可用 fail-open + 告警日志 · `4A` resume 与新聊共用同一套配额。

依据总方案 [design.md](./design.md)、模块 [module-decomposition.md](./module-decomposition.md)，并与已实现 [M1–M4](./design-m1-m4.md) 对齐。

---

## 1. 总体架构

```
                    ┌─────────────────────────────────────┐
                    │  lib/redis/rateLimitRedis.ts        │
                    │  （接口：eval / pipeline 能力）      │
                    └──────────────┬──────────────────────┘
                                   │ 实现
              ┌────────────────────┼────────────────────┐
              ▼                    ▼                    ▼
     ┌────────────────┐  ┌────────────────┐   （无 Redis）
     │ ioredis 适配    │  │ Upstash 适配  │   fail-open
     └────────────────┘  └────────────────┘
                                   │
                    ┌──────────────▼──────────────┐
                    │ lib/chat/rateLimit.ts       │
                    │ assertChatRateLimit(...)    │
                    │ · Lua 滑动窗口             │
                    │ · 先 user 后 IP (4C)       │
                    └──────────────┬────────────┘
                                   │
                    ┌──────────────▼──────────────┐
                    │ M2 chatLog                  │
                    │ rate_limit / redis_unavail  │
                    └─────────────────────────────┘
```

- **编排位置**（M10）：`auth` 取得 `guestId` 后、`JSON.parse` body 前或后均可；与总方案一致建议 **鉴权 → 限流 → 解析 → M3 → M4**。限流只依赖 `NextRequest` + `guestId`，不依赖 `messages` 正文。
- **4A**：每个维度（user / IP）独立 **滑动时间窗口**，窗口内请求次数 ≤ 阈值。
- **4C**：同一请求内 **先** `ratelimit:user:{guestId}`，**再** `ratelimit:ip:{ipHash}`；先失败则返回 `RATE_LIMIT_USER`，不再查 IP（可选：仍查 IP 以同时暴露两类限流——本设计采用 **短路**，减少 Redis 往返）。
- **4A（resume）**：`resume` 与普通聊天 **共用** 同一计数器；每次 `POST /api/chat` 计 **1 次**（无论 body 是 resume 还是新消息）。

---

## 2. 技术选型与理由

| 项 | 选型 | 理由 |
|----|------|------|
| Redis 接入 | **接口 + 双实现**（`1C`） | `ioredis` 适合长连 TCP；`@upstash/redis` 适合边缘/Serverless；用 env 切换，业务只依赖接口。 |
| 窗口算法 | **Lua 原子脚本**（`2A`） | 与 4A 语义一致；单次往返内完成 ZSET 裁剪 + 计数，避免竞态。 |
| 不可用策略 | **Fail-open**（`3A`） | 主链路可用性优先；必须打 **warn** 级结构化日志，便于告警。 |
| 常量与错误码 | **扩展 M1** | `RATE_LIMIT_*` 上限默认值 + env 覆盖，与现有 `CHAT_*` 策略 B 一致。 |

**不推荐**在 M5 引入新的重量级依赖；`ioredis` / `@upstash/redis` 二选一安装，由工厂按 env 懒加载。

---

## 3. 滑动窗口（Lua）语义

对每个 key（如 `ratelimit:user:{guestId}`）使用 **Sorted Set**：

- **score**：请求时间戳（毫秒，`Date.now()`）。
- **member**：唯一 id，如 `{timestamp}-{random}` 或 `nanoid`，避免同毫秒冲突。
- **Lua 逻辑（概念）**：
  1. `now = ARGV[1]`，`windowMs = ARGV[2]`，`limit = ARGV[3]`。
  2. `ZREMRANGEBYSCORE key 0 (now - windowMs)` 移除窗口外成员。
  3. `ZCARD key`；若 `>= limit` 则返回 `{0, retryAfterMs}`（拒绝）。
  4. 否则 `ZADD key now member`，`PEXPIRE key windowMs + slack`（如 `windowMs + 1000`），返回 `{1, remaining}`。

**说明**：Upstash 与 ioredis 均支持 `EVAL`；Upstash REST 也提供脚本执行能力，需在适配层封装为统一 `evalSha` / `eval`。

---

## 4. 性能考量

- **往返次数**：理想情况每请求 **1 次 Lua（user）+ 可选 1 次 Lua（IP）**；user 命中限流则 **不调用** IP。
- **键 TTL**：脚本内 `PEXPIRE`，避免冷 key 永久驻留。
- **热 key**：`guestId` 已天然分键；IP 使用 **hash**（如对 IP 字符串 `sha256` 取前 16 hex）缩短键长、避免特殊字符。

---

## 5. 安全性考量

- **IP 来源**：从 `NextRequest.headers.get('x-forwarded-for')` 取 **第一个** hop 仅当 `TRUST_PROXY=1`（或等价 env），否则使用 `req.ip` / 直连地址（视 Next.js 暴露能力而定）。**文档化**：错误配置会导致限流绕过或误伤。
- **不记录完整 IP 到日志**：可记录 `ipHash` 或 `/24` 掩码（按需），与 M2「不落全文」一致。
- **429 响应体**：`{ "error": "...", "code": "RATE_LIMIT_USER" | "RATE_LIMIT_IP" }`，与现有 JSON 错误风格一致。

---

## 6. 可扩展性

- **多租户**：键前缀可扩展为 `ratelimit:user:{tenantId}:{guestId}`（本期可不加）。
- **分桶调额**：仅调整 env 中 `CHAT_RATE_LIMIT_USER_MAX`、`CHAT_RATE_LIMIT_IP_MAX`、`CHAT_RATE_LIMIT_WINDOW_MS`（名称示例）。

---

## 7. 复用性设计

| 模块 | 职责 |
|------|------|
| `lib/redis/rateLimitRedis.ts` | 定义 `RateLimitRedis`：`eval(script, keys, args)` 或最小封装 |
| `lib/redis/ioredisRateLimit.ts` | 实现 |
| `lib/redis/upstashRateLimit.ts` | 实现 |
| `lib/redis/getRateLimitRedis.ts` | 读 `REDIS_DRIVER` / `REDIS_URL` / Upstash 变量，返回单例或 null |
| `lib/chat/rateLimit.ts` | Lua 脚本常量、`assertChatRateLimit(req, guestId)`、`ChatRateLimitError` |
| `lib/chat/limits.ts`（扩展） | `getRateLimitConfig()`：窗口 ms、user/ip 阈值 |

`assertChatRateLimit` **抛** 可映射 429 的错误（含 `code` + `retryAfterMs`）；由 `route` 捕获转 `NextResponse.json(..., { status: 429, headers: { 'Retry-After': ... } })`。

---

## 8. 对现有系统的影响

- **新增依赖**（二选一或都装，运行时选一）：`ioredis` 和/或 `@upstash/redis`。
- **`limits.ts`**：新增 `RATE_LIMIT_*` 常量与 env 键枚举；可选 `RateLimitErrorCode` 或并入现有 `ChatErrorCode`（建议 **独立** `RateLimitErrorCode` 避免污染校验码）。
- **`route.ts`**：M10 串联时在解析 body 前调用限流（仅需 `guestId` + `req`）；**不改变** NextAuth 与 resume 安全校验顺序（resume 仍随后做 session 归属校验）。

---

## 9. 关键接口草案

```ts
// lib/chat/rateLimit.ts
export type RateLimitDeniedCode = "RATE_LIMIT_USER" | "RATE_LIMIT_IP";

export class ChatRateLimitError extends Error {
  readonly code: RateLimitDeniedCode;
  readonly retryAfterMs: number;
}

/** Redis 不可用时：fail-open，不打 throw */
export async function assertChatRateLimit(
  req: NextRequest,
  guestId: string,
): Promise<void>;
```

```ts
// lib/redis/rateLimitRedis.ts（概念）
export interface RateLimitRedis {
  eval(script: string, keys: string[], args: (string | number)[]): Promise<unknown>;
}
```

**环境变量（示例）**

| 变量 | 含义 |
|------|------|
| `REDIS_DRIVER` | `ioredis` \| `upstash` |
| `REDIS_URL` | ioredis 连接串 |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Upstash |
| `CHAT_RATE_LIMIT_WINDOW_MS` | 滑动窗口长度 |
| `CHAT_RATE_LIMIT_USER_MAX` | 每窗口每用户最大请求数 |
| `CHAT_RATE_LIMIT_IP_MAX` | 每窗口每 IP 最大请求数 |
| `TRUST_PROXY` | `1` 时信任 `X-Forwarded-For` 第一段 |

默认值写入 `limits.ts`，非法解析回退并 `chatLog('warn', 'env_parse_failed', …)`（与 M1 一致）。

---

## 10. 风险与应对

| 风险 | 可能性 | 影响程度 | 应对措施（上线前） |
|------|--------|----------|---------------------|
| Redis 故障导致无限流 | 中（`3A`） | 高 | Fail-open + 监控 `redis_unavail` 日志；关键环境可后续加 `CHAT_RATE_LIMIT_STRICT=1` 变 fail-closed |
| Lua/EVAL 在各驱动行为差异 | 低 | 中 | 双驱动集成测试；脚本版本化（`SCRIPT LOAD` + SHA） |
| X-Forwarded-For 伪造 | 中 | 中 | 仅信任受控网关；`TRUST_PROXY` 默认 off |
| 热 key / 大窗口 ZSET | 低 | 中 | 窗口 + PEXPIRE；限制 `windowMs` 上限防 OOM |
| resume 与新聊同配额导致重连用户被 429 | 低 | 低 | 已选 4A；若反馈强烈再引入 `4B` 独立阈值 |

---

## 11. 文档版本

| 日期 | 说明 |
|------|------|
| 2026-04-02 | 初版；决策 1C/2A/3A/4A 确认 |

---

请确认以上方案是否符合预期。确认后可进入实现阶段（建议顺序：`RateLimitRedis` 适配 → `rateLimit.ts` + `limits` 扩展 → M10 串联）。如需调整（例如 strict 模式默认、IP 日志策略），请在实现前说明。
