# M10 / M8 / M11 技术设计（编排、Redis 会话、前端草稿）

本文档记录已确认架构决策与实现约束，总览见 [design.md](./design.md)、依赖关系见 [module-decomposition.md](./module-decomposition.md)。

## 已确认决策摘要

| 编号 | 决策 |
|------|------|
| **1A** | M8 会话存储与 M5 限流**共用同一 Redis 实例**（与 `REDIS_DRIVER` / `REDIS_URL` 或 Upstash 变量一致），**键前缀**区分业务（如 `ratelimit:*` 与 `stream:*` / `session:*`，具体以前缀实现为准）。 |
| **2B** | **`StreamSessionStore` 深注入**：`route` 取得 store 后传入 `handleChatStream`、`replayAndFollow`、`createSSEWriter` 等，业务热路径不隐式调用 `getStreamSessionStore()`。 |
| **3A** | 集成测试：**Vitest/Jest** + `describe.each(['memory','redis'])`；CI/本地通过 `REDIS_URL` 提供 Redis。 |
| **4A** | M11：默认 **sessionStorage**；**NextAuth `events.signOut`** + 客户端清理草稿 key。 |

## M10：`route` 编排顺序

**鉴权 → M5 限流 → 解析 body → M3 校验 → M4 预算 → resume 分支 / `handleChatStream`**

- `handleChatStream` 签名增加 `store: StreamSessionStore`，与 resume 分支使用**同一实例**。
- M3/M4 错误映射为稳定 HTTP 状态与 `code`（与 [design-m1-m4.md](./design-m1-m4.md) 一致）。

## M8：`RedisStreamSessionStore`

- 实现文件：`lib/sseServer/streamSession.redis.ts`（与 [design-m6-m9-session-store.md](./design-m6-m9-session-store.md) 一致）。
- 工厂 `getStreamSessionStore()` 按 env 在内存实现与 Redis 实现间切换。
- **env（与 `lib/chat/limits.ts` 一致）**：`CHAT_SESSION_STORE`（`memory`|`redis`，默认 `memory`）、`CHAT_SESSION_TTL_MS`、`CHAT_SESSION_REDIS_URL`（可选）；`appendEvent` 使用 Lua + `cjson`（自建 Redis / Upstash 需支持）。

---

## M5 与 M8 同 Redis 实例（1A）：运维、TTL 与配置演进

> **风险**：同实例故障或延迟升高会同时影响**限流**与**续传会话**两侧（可能性：中，影响：高）。  
> 下列三条为**设计层必须约定**的缓解与演进手段（实现与监控可在上线前分阶段落地）。

### 1. 监控：按键前缀区分负载与延迟

生产环境应对至少两组命名空间分别观测（前缀名与实现保持一致即可）：

- **限流**：`ratelimit:*`（与 [design-m5-rate-limit.md](./design-m5-rate-limit.md) 一致）。
- **会话 / 续传**：会话 store 使用的键前缀（如 `session:*`、`stream:*`）。

**指标建议**：各前缀下的 **QPS**、**P99（或 P95）延迟**、Redis **错误率** / 超时次数；可选 **内存与连接数**，便于区分「限流 Lua 热点」与「会话大 value / 高频 append」。

### 2. 会话 TTL 与限流时间窗口分离

- **M5 滑动窗口**：由 `CHAT_RATE_LIMIT_WINDOW_MS` 等与 ZSET 语义绑定（见 `getRateLimitConfig()`）。
- **M8 会话数据 TTL**：由独立配置项约束（例如 `CHAT_SESSION_TTL_MS` 或等价 env，名称在实现阶段写入 `limits.ts` 与本文交叉引用）。

**设计原则**：会话生命周期（续传可接受窗口、数据何时可被清理）与「每分钟允许多少次请求」**不得共用同一数值**；文档与默认值上保持语义分离，避免运维误调一侧影响另一侧行为。

### 3. 配置层预留：未来拆分独立会话 Redis URL

在不改变默认 **1A**（共用实例）的前提下，工厂层预留可选第二连接：

- **可选 env**：`CHAT_SESSION_REDIS_URL`（或与 `REDIS_DRIVER` 对齐的命名约定）。
- **行为**：若已设置且非空，则 **M8** `StreamSessionStore` 使用该 URL；**M5** 仍使用现有 `REDIS_URL` / Upstash 变量。  
- **若未设置**：回退为与 M5 **相同**连接配置（当前 1A 行为）。

便于在监控显示会话与限流争抢资源或故障域需隔离时，**仅通过配置**切换到独立实例，无需改业务编排代码。

---

## M11：前端草稿与 SignOut（最后实现）

- 存储：**sessionStorage**，按 `conversationId` 分 key（与总方案 3C/4B 对齐）。
- 登出：**NextAuth `events.signOut`**（服务端钩子，可选审计）+ 客户端在登出流程中 **删除对应草稿 key**，避免仅依赖一种环境。

---

## 风险与应对（摘录）

| 风险 | 可能性 | 影响程度 | 应对措施（上线前完成） |
|------|--------|----------|------------------------|
| M8 与 M5 同 Redis，故障或慢影响两侧 | 中 | 高 | 1. **监控分键前缀** QPS / latency / 错误率 2. **会话 TTL 与限流窗口**独立配置与文档 3. **`CHAT_SESSION_REDIS_URL` 可选**，未设则与 `REDIS_URL` 共用，支持无代码拆分 |
| 深注入（2B）遗漏隐式单例 | 中 | 高 | Grep 校验、集成测试 memory/redis 双跑、CR 清单 |

请确认以上设计与 env 命名在实现阶段与 `lib/chat/limits.ts` 同步；确认后可进入编码与验收用例更新。

## 实现与验收文档

- [implementation-summary-m10-m8-m11.md](./implementation-summary-m10-m8-m11.md)
- [acceptance-m10-m8-m11.md](./acceptance-m10-m8-m11.md)
