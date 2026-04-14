# M6–M9 实现总结（续传存储）

## 实现概述

- 引入 **`StreamSessionStore`** 异步接口与 **`MemoryStreamSessionStore`**（进程内 `Map`），替代 `streamSession.ts` 顶层裸 `Map`。
- SSE 写入统一经 **`appendEvent`**，实现 **5A**（`maxEvents` + UTF-8 `maxBytes` 双上限，从队列头丢最旧），超限打 **`buffer_trimmed`** 日志。
- **`replayAndFollow`** 改为按 `streamId` 轮询 **`store.get`**，以 store 为真源。
- **未新增 npm 依赖**。

## 涉及的文件

| 文件 | 作用 |
|------|------|
| `lib/sseServer/streamSessionStore.ts` | `BufferedEvent` / `StreamSession` / `StreamSessionStore`、`getStreamSessionStore()` |
| `lib/sseServer/streamSession.memory.ts` | `MemoryStreamSessionStore`：create/get/append/mark、延迟清理、5A |
| `lib/sseServer/streamSession.ts` | `parseEventId`、`createStreamSession`、`getStreamSession`、`mark*`、`createSSEWriter` / `createSSEWriterWithDefaults`、`replayAndFollow` |
| `lib/chat/limits.ts` | `CHAT_BUFFER_MAX_*`、`getBufferLimits()`、`BufferLimits` |
| `lib/observability/chatLog.ts` | 事件名 `buffer_trimmed` |
| `lib/sseServer/chatHandler.ts` | `await createStreamSession`、`createSSEWriterWithDefaults`、`await markSessionDone/Error` |
| `app/api/chat/route.ts` | `await getStreamSession`、`replayAndFollow(store, streamId, …)` |

## 新增接口

### `getBufferLimits(): BufferLimits`

- **返回**：`{ maxEvents, maxBytes }`
- **env**：`CHAT_BUFFER_MAX_EVENTS`（默认 50000）、`CHAT_BUFFER_MAX_BYTES`（默认 50_000_000）

### `getStreamSessionStore(): StreamSessionStore`

- 单例；当前固定为内存实现。

### `StreamSessionStore`

- `create(guestId)` / `get(streamId)` / `appendEvent(streamId, ev, opts)` / `markDone` / `markError`
- `appendEvent` 在会话不存在时 **throw** `StreamSession not found`

### `createSSEWriter(session, encoder, writerRef, { store, buffer })`

- 显式注入 store 与缓冲上限。

### `createSSEWriterWithDefaults(session, encoder, writerRef)`

- 使用 `getStreamSessionStore()` + `getBufferLimits()`。

### `replayAndFollow(store, streamId, lastSeqExclusive, writer, encoder, signal?)`

- 签名变更：不再传入整个 `StreamSession` 快照作为唯一数据源。

## 依赖关系

`chatHandler` → `createStreamSession` / `createSSEWriterWithDefaults` → `getStreamSessionStore().appendEvent`  
`route`（续传）→ `getStreamSession` + `replayAndFollow(getStreamSessionStore(), …)`

## 自动化验收

- `npm run test:m6-m9` → `scripts/m6-m9-acceptance.ts`（MemoryStreamSessionStore、5A、`replayAndFollow`、`createSSEWriter`）。

## 后续待办

- **M8**：`RedisStreamSessionStore` + `getStreamSessionStore()` 按 env 切换。
- **M10**：route 注入 store（可选，当前已用全局单例）。

## 文档版本

| 日期 | 说明 |
|------|------|
| 2026-04-03 | 初版 |
