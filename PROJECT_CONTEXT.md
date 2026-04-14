# 项目上下文

## 技术栈

- **框架**：Next.js 14（App Router）、React 18、TypeScript
- **状态**：Zustand（含聊天相关 store）
- **认证**：NextAuth v5
- **样式**：Tailwind CSS
- **Redis（M5 限流 + M8 会话可选同实例）**：`ioredis`（TCP）与 `@upstash/redis`（HTTP）二选一，由 env 决定；均为纯 JS 客户端，无 node-gyp。默认 **M5 与 M8 共用同一连接**；可按 [design-m10-m8-m11.md](docs/features/chat-enterprise-enhancements/design-m10-m8-m11.md) 使用可选 **`CHAT_SESSION_REDIS_URL`** 将会话迁到独立实例。
- **集成测试**：`vitest`（`npm run test:integration`），`*.integration.test.ts`；Redis 用例在 **`REDIS_URL` 未设置时** `skip`。
- **本机聊天快照**：`idb-keyval`（IndexedDB）；数据库名 `wildoasis-chat`，store `persistence`，键 `snapshot:v1`（见 `lib/chat/chatPersistence.ts`）。

## 目录结构（节选）

- `app/api/chat/route.ts` — 聊天 SSE API；编排顺序：**鉴权 → M5 限流 → 解析 body → M3 校验 → M4 预算 → resume / handleChatStream**（`store` 自 `getStreamSessionStore()` 注入）
- `lib/chat/` — `limits`（M1+M5 常量）、`validateRequest`（M3）、`budget`（M4）、`rateLimit`（M5）
- `lib/redis/` — `rateLimitRedis` 接口、`ioredisRateLimit`、`upstashRateLimit`、`getRateLimitRedis`
- `lib/observability/chatLog.ts` — 结构化单行 JSON（含 `redis_unavail`、`rate_limit`）
- `lib/sseServer/` — SSE 服务端（`chatHandler`、`streamSession`、`streamSessionStore`、`streamSession.memory`、`streamSession.redis`）
- `lib/redis/sessionRedisFactory.ts` — M8 会话专用 Redis 连接（`CHAT_SESSION_REDIS_URL` 或复用 M5 配置）
- `lib/chat/chatDraftStorage.ts` — M11 输入草稿 `sessionStorage` 前缀与登出清理
- `lib/chat/chatPersistence.ts` — `loadSnapshot` / `saveSnapshot` / `clearChatPersistence`；与 M11 草稿命名空间独立
- `lib/chat/streamingTextSink.ts` — `createStreamingTextSink`：`delta`/`thinking` 经 rAF + `maxDelayMs`（默认 `DEFAULT_STREAMING_TEXT_MAX_DELAY_MS`）批量再调用 `updateLastAssistant` / `appendThinking`；`useChatStream` 在 `done`/`error`/`tool_call` 与各退出路径上 `flushAll`/`clear`（401 仅 `clear`），见 [chat-sse-raf-batching/design.md](docs/features/chat-sse-raf-batching/design.md)
- `components/chat/ChatPersistenceProvider.tsx` — 首屏 hydrate、`subscribe` 防抖写回、`beforeunload` flush
- `types/chat.ts` — `Message`、`ChatRequestBody` 等

## 核心业务规则（聊天增强）

### M1–M4

- **上限（M1）**：默认值在 `lib/chat/limits.ts`，`CHAT_*` env 覆盖；非法 env 回退并 `chatLog('warn', 'env_parse_failed', …)`。
- **计量 / 验证 / 预算**：见原 M1–M4 说明（码点、`validateChatRequestBody`、`applyBudgetOrThrow`）。
- **续传缓冲（M6–M7/M9）**：`getBufferLimits()`（`CHAT_BUFFER_MAX_EVENTS`、`CHAT_BUFFER_MAX_BYTES`）；SSE 事件经 `StreamSessionStore.appendEvent`，5A 丢头时 `chatLog('warn','buffer_trimmed',…)`。
- **会话存储（M8）**：`CHAT_SESSION_STORE`=`memory`|`redis`（默认 `memory`）；`CHAT_SESSION_TTL_MS` 会话 TTL；`CHAT_SESSION_REDIS_URL` 可选；Redis 键前缀 `stream:session:`，与 `ratelimit:*` 分离。
- **M11 草稿**：`wildoasis:chat:draft:{conversationId}` 存于 **sessionStorage**；登出时 `clearAllChatDrafts()`（`SignOutButton` 与 `apiFetch` 401 路径）。
- **本机对话持久化（IndexedDB）**：刷新后恢复 `conversations` / `activeId`，与 M8 解耦；`store/chatStore` 含 `_persistenceHydrated`、`hydrateFromPersistence`、`clearAllConversations`；**登出 / `apiFetch` 401 / 侧栏「清空本机」** 调用 `clearChatPersistence` + `clearAllChatDrafts` + `clearAllConversations`。方案见 [design.md](docs/features/chat-persistence-local-idb/design.md)，验收见 [acceptance.md](docs/features/chat-persistence-local-idb/acceptance.md)。

### M5 限流

- **算法**：Redis **Lua + ZSET** 滑动窗口；键 `ratelimit:user:{guestId}`、`ratelimit:ip:{sha256(ip).slice(0,16)}`。
- **顺序（4C）**：先 user，命中则 **429** 且不再检查 IP；否则再检查 IP。
- **无 Redis**：默认 **fail-open**（放行）并 `chatLog('warn','redis_unavail',…)`；`CHAT_RATE_LIMIT_STRICT=1` 且无客户端或 **eval 失败** 时 **503**（`REDIS_UNAVAILABLE`）。
- **TRUST_PROXY**：`1`/`true` 时客户端 IP 取 `X-Forwarded-For` 第一段；否则用 `x-real-ip` / `cf-connecting-ip` / `unknown`。
- **429**：`{ error, code: 'RATE_LIMIT_USER' | 'RATE_LIMIT_IP' }`，响应头 **`Retry-After`**（秒，向上取整）。
- **env**：`REDIS_DRIVER`（`ioredis`|`upstash`）、`REDIS_URL`、`UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`、`CHAT_RATE_LIMIT_WINDOW_MS`、`CHAT_RATE_LIMIT_USER_MAX`、`CHAT_RATE_LIMIT_IP_MAX`、`TRUST_PROXY`、`CHAT_RATE_LIMIT_STRICT`。

## 接口/类型定义

- **`ChatErrorCode`**（`lib/chat/limits.ts`）：校验与预算错误码
- **`getRateLimitConfig()`**（`lib/chat/limits.ts`）：窗口 ms、user/ip 上限、`trustProxy`、`strict`
- **`assertChatRateLimit(req, guestId)`**（`lib/chat/rateLimit.ts`）：异步；可能抛 **`ChatRateLimitError`**、**`ChatRateLimitRedisError`**
- **`ChatRateLimitError`**：`code`、`retryAfterMs`
- **`chatLog`**：事件含 `redis_unavail`、`rate_limit`、`buffer_trimmed`
- **`StreamSessionStore`**（`lib/sseServer/streamSessionStore.ts`）：`create` / `get` / `appendEvent` / `markDone` / `markError`；默认 **`MemoryStreamSessionStore`**；`CHAT_SESSION_STORE=redis` 且 Redis 可用时为 **`RedisStreamSessionStore`**
- **`handleChatStream(..., store)`**（`lib/sseServer/chatHandler.ts`）：深注入 `store`，与 `replayAndFollow` 共用同一实例
- **`getBufferLimits()`**（`lib/chat/limits.ts`）：续传缓冲条数与 UTF-8 字节上限
- **`ChatPersistenceSnapshot`**（`lib/chat/chatPersistence.ts`）：`schemaVersion`、`savedAt`、`activeId`、`conversations`；`saveSnapshot` 在 `chatState !== "idle"` 时对当前会话最后一条 assistant 写入副本并标 `streamStopped`，避免刷新后误拼进下一轮请求
- **`StreamingTextSink`**（`lib/chat/streamingTextSink.ts`）：`pushDelta` / `pushThinking` / `flushAll` / `clear`；`tool_call` 仍直写 `upsertToolCall`，事件前 `flushAll` 以保证顺序

## 功能文档索引

| 功能 | 需求 | 技术方案 | 模块划分 | M1–M4 子设计 |
|------|------|----------|----------|----------------|
| 聊天增强（企业向） | [requirements.md](docs/features/chat-enterprise-enhancements/requirements.md) | [design.md](docs/features/chat-enterprise-enhancements/design.md) | [module-decomposition.md](docs/features/chat-enterprise-enhancements/module-decomposition.md) | [design-m1-m4.md](docs/features/chat-enterprise-enhancements/design-m1-m4.md) |

**M1–M4 实现与验收**：[implementation-summary-m1-m4.md](docs/features/chat-enterprise-enhancements/implementation-summary-m1-m4.md) · [acceptance.md](docs/features/chat-enterprise-enhancements/acceptance.md)

**M5 限流**：[design-m5-rate-limit.md](docs/features/chat-enterprise-enhancements/design-m5-rate-limit.md) · [implementation-summary-m5.md](docs/features/chat-enterprise-enhancements/implementation-summary-m5.md) · [acceptance-m5.md](docs/features/chat-enterprise-enhancements/acceptance-m5.md)

**M6–M9 续传存储（接口冻结、内存实现、SSE 接入 appendEvent/5A）**：[design-m6-m9-session-store.md](docs/features/chat-enterprise-enhancements/design-m6-m9-session-store.md) · [implementation-summary-m6-m9.md](docs/features/chat-enterprise-enhancements/implementation-summary-m6-m9.md) · [acceptance-m6-m9.md](docs/features/chat-enterprise-enhancements/acceptance-m6-m9.md) · 脚本：`npm run test:m6-m9`

**M10 / M8 / M11（编排、Redis 会话、草稿；含同实例运维与 `CHAT_SESSION_REDIS_URL` 预留）**：[design-m10-m8-m11.md](docs/features/chat-enterprise-enhancements/design-m10-m8-m11.md) · [implementation-summary-m10-m8-m11.md](docs/features/chat-enterprise-enhancements/implementation-summary-m10-m8-m11.md) · [acceptance-m10-m8-m11.md](docs/features/chat-enterprise-enhancements/acceptance-m10-m8-m11.md) · `npm run test:integration`

**本机聊天持久化（IndexedDB，与 M8 解耦）**：[design.md](docs/features/chat-persistence-local-idb/design.md) · [implementation-summary.md](docs/features/chat-persistence-local-idb/implementation-summary.md) · [acceptance.md](docs/features/chat-persistence-local-idb/acceptance.md)

**SSE 客户端 rAF + maxDelay 批量写入**：[design.md](docs/features/chat-sse-raf-batching/design.md)
