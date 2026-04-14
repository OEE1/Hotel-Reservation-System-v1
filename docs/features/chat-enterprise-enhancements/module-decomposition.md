# 聊天增强（企业向）模块划分

依据 [design.md](./design.md) 与 [requirements.md](./requirements.md) 拆解实现单元，便于分阶段开发与测试。

---

## 1. 模块划分列表

| # | 子模块 | 粒度说明 |
|---|--------|----------|
| M1 | **共享常量与类型**（`limits` + 错误码） | 各模块共用的数值上限与 `RATE_LIMIT_*` 等约定 |
| M2 | **结构化日志**（`chatLog`） | 6A：统一 `event` / `guestId` / `streamId` / `reason` |
| M3 | **请求体验证**（`validateRequest`） | 5C：role、非空、条数、单条长度；可被 route 单测 |
| M4 | **上下文预算**（`budget`） | 2C 计量 + 3B 裁剪；依赖 M1 |
| M5 | **聊天限流**（`rateLimit`） | 4A + 4C；依赖 Redis 与 M1/M2 |
| M6 | **StreamSessionStore 接口** | 抽象 `create/get/append/mark*` |
| M7 | **内存会话存储** | 开发/测试；实现 M6，对接现有 `replayAndFollow` 所需行为 |
| M8 | **Redis 会话存储** | 生产；实现 M6，含序列化、TTL、5A 丢弃最旧 |
| M9 | **SSE 管线适配** | 改造 `createSSEWriter` / `replayAndFollow` 或薄封装，使写入走 `store.appendEvent` |
| M10 | **`handleChatStream` + `route` 编排** | 注入 store、串联校验→预算→限流→流；resume 分支读 store |
| M11 | **前端草稿（3C + 4B）** | sessionStorage 默认 + 可选 localStorage；按 `conversationId` 分 key；登出清理 |

M1–M5 偏「纯逻辑」；M6–M9 偏「续传基础设施」；M10 为集成；M11 可前后端并行（依赖 `conversationId` 约定）。

---

## 2. 模块关系图

```
                    ┌─────────┐
                    │   M1    │ limits / codes
                    └────┬────┘
         ┌───────────────┼───────────────┐
         ▼               ▼               ▼
    ┌────────┐     ┌──────────┐    ┌──────────┐
    │   M2   │     │    M3    │    │    M4    │
    │ chatLog│     │ validate │    │ budget   │
    └───┬────┘     └────┬─────┘    └────┬─────┘
        │               │               │
        └───────────────┼───────────────┘
                        ▼
                 ┌──────────────┐
                 │  M5 rateLimit│ ──► Redis
                 └──────┬───────┘
                        │
    ┌───────────────────┼───────────────────────────┐
    ▼                   ▼                           ▼
┌────────┐        ┌──────────┐                 ┌──────────┐
│   M6   │◄───────│ M7 mem   │                 │ M10 route│
│interface       │ M8 redis │────────────────►│+ handler │
└───┬────┘        └────┬─────┘                 └────┬─────┘
    │                  │                            │
    └────────┬─────────┘                            │
             ▼                                      │
        ┌─────────┐                                 │
        │ M9 SSE   │◄──────────────────────────────┘
        │ adapter │
        └─────────┘

        ┌─────────┐
        │ M11 草稿 │  （依赖 conversationId 类型与 UI）
        └─────────┘
```

- **并行**：M2、M3、M4 可在 M1 定稿后并行；M7 与 M8 在 M6 接口稳定后可并行。
- **顺序**：M6 先于 M7/M8；M9 依赖 M6 + 任一存储实现；M10 依赖 M3、M4、M5、M9；M11 可与 M10 并行，但需在类型层约定 `conversationId`。

---

## 3. 实现顺序建议

1. **M1** — 所有上限与魔法数字集中，避免各文件重复改常量。
2. **M2** — 后续预算丢弃、限流命中都要打日志，先统一出口。
3. **M3、M4** — 无 Redis 也可单元测试；与 `route` 集成成本低。
4. **M6** — 冻结 `StreamSessionStore` 与 `BufferedEvent` 持久化形状。
5. **M7** — 默认路径：先替换现有 `Map`，行为与现网一致，便于回归。
6. **M9** — 把 `createSSEWriter` / 会话生命周期接到 `appendEvent`（含 5A）。
7. **M10** — `route`：`auth` → **M5** → 解析 → **M3** → **M4** → resume / `handleChatStream`；`handleChatStream` 注入 store。
8. **M8** — 接 Redis；与 M7 同测用例双跑（集成测试）。
9. **M11** — 前端草稿与 SignOut 清理，最后做可避免反复改 API。

**原因**：先打通「校验 + 预算 + 内存续传」闭环，再加重依赖的 Redis 与限流；草稿依赖稳定请求体字段，适合收尾。

---

## 4. 各子模块说明

### M1 共享常量与类型

- **职责**：`MAX_*`、`KEEP_LAST_TURNS`、缓冲 `maxEvents`/`maxBytes`；429/400 的 `code` 字面量类型。
- **对外**：导出常量与 `RateLimitCode` 等类型。
- **依赖**：无。

### M2 结构化日志（`lib/observability/chatLog.ts`）

- **职责**：单行 JSON 日志，字段符合 design 第 6 节。
- **对外**：`chatLog.info(event, fields)` 等。
- **依赖**：M1（可选，用于 `event` 枚举）。

### M3 请求体验证（`lib/chat/validateRequest.ts`）

- **职责**：校验 `ChatRequestBody`；非法返回结构化错误供 route 映射 400。
- **对外**：`validateChatRequest(body): Result` 或抛 `ValidationError`。
- **依赖**：M1；`types/chat`。

### M4 上下文预算（`lib/chat/budget.ts`）

- **职责**：2C 估算；3B 裁剪；返回 `removedCount` 供 M2 记 `context_trimmed`。
- **对外**：`estimateContext`、`trimMessages`。
- **依赖**：M1；`Message` 类型。

### M5 聊天限流（`lib/chat/rateLimit.ts`）

- **职责**：4A 滑动窗口；4C 先 user 后 IP；失败抛可映射 429 的错误。
- **对外**：`assertChatRateLimit(req, guestId)`。
- **依赖**：M1、M2；Redis 客户端。

### M6 StreamSessionStore 接口（`lib/sseServer/streamSessionStore.ts`）

- **职责**：定义异步存储契约（与 design 第 10 节一致）。
- **对外**：`StreamSessionStore` 接口 + 工厂 `getStreamSessionStore()`（按 env 选实现）。
- **依赖**：现有 `StreamSession` / `BufferedEvent` 类型（可放在同目录或从 `streamSession` 迁出）。

### M7 内存实现（`streamSession.memory.ts`）

- **职责**：替换当前 `Map`；实现 TTL、`appendEvent` 内 5A。
- **对外**：实现 M6。
- **依赖**：M6、M2。

### M8 Redis 实现（`streamSession.redis.ts`）

- **职责**：序列化会话与事件列表；TTL；`append` 时条数/字节与 5A。
- **对外**：实现 M6。
- **依赖**：M6、M2、Redis。
- **运维与配置**：与 M5 默认共用 Redis 时的**分前缀监控**、**会话 TTL 与限流窗口分离**、可选 **`CHAT_SESSION_REDIS_URL`** 拆分，见 [design-m10-m8-m11.md](./design-m10-m8-m11.md)（§「M5 与 M8 同 Redis 实例」）。

### M9 SSE 适配

- **职责**：`createSSEWriter` 写入时调用 `store.appendEvent`；`replayAndFollow` 从 store 读到的 session 上工作（或经 `get` 刷新）。
- **对外**：与现 `chatHandler` 内部函数签名对齐。
- **依赖**：M6、M7（或 M8）。

### M10 Route + handleChatStream 编排

- **职责**：`app/api/chat/route.ts` 顺序编排；`handleChatStream` 接收 `store` 与已处理 `messages`。
- **对外**：HTTP 行为不变，新增可选 `conversationId` 仅透传/日志。
- **依赖**：M3–M9。

### M11 前端草稿

- **职责**：3C + 4B；与 `chatUIStore`/`chatStore` 协调；登出清理。
- **对外**：hooks 或 store 动作。
- **依赖**：`conversationId`（M10 已在 body 可选支持）。

---

## 5. 文档版本

| 日期 | 说明 |
|------|------|
| 2026-04-01 | 初版，对应 design 模块划分 |
| 2026-04-03 | M8 增加同实例运维与 `CHAT_SESSION_REDIS_URL` 设计引用（design-m10-m8-m11） |
