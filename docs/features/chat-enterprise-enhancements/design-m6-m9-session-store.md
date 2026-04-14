# M6–M9：StreamSessionStore、内存实现与 SSE 适配（设计）

本文档对应总览：[design.md](./design.md)、[module-decomposition.md](./module-decomposition.md)。  
架构决策继承：**`1C`（StreamSessionStore）**、**`5A`（续传缓冲条数/字节双上限，超限从队列头丢弃最旧事件）**。

---

## 1. 范围

| 里程碑 | 内容 |
|--------|------|
| **M6** | 冻结 `StreamSessionStore` 接口与 `BufferedEvent` / `StreamSession` 持久化形状 |
| **M7** | 默认路径：用内存实现替换进程内 `Map`，行为与现网单进程一致，便于回归 |
| **M9** | 将 `createSSEWriter` 与会话生命周期接到 `store.appendEvent`（含 **5A**） |

> **M8**（Redis 实现）不在本文展开，仅说明接口如何预留。

---

## 2. 现状与目标数据流

**现状**（`lib/sseServer/streamSession.ts`）：

- 模块级 `Map<streamId, StreamSession>`；
- `createSSEWriter` 直接 `session.events.push(...)`；
- `replayAndFollow` 轮询同一内存中的 `session.events`；
- `markSessionDone` / `markSessionError` 更新状态并延迟清理。

**目标**：

1. 所有会话读写经 **`StreamSessionStore`**；
2. 事件追加只通过 **`appendEvent`**，并在其中执行 **5A**；
3. **M7** 默认仅 **`MemoryStreamSessionStore`**（内部仍可用 `Map`），语义与现实现一致（未触发 5A 时）。

---

## 3. 冻结类型（M6）

### 3.1 `BufferedEvent`（持久化单元）

与当前实现一致，作为跨存储（内存 / Redis）的稳定形状：

| 字段 | 类型 | 说明 |
|------|------|------|
| `seq` | `number` | 单调递增序号 |
| `id` | `string` | 格式 `` `${streamId}:${seq}` ``，与 SSE `id` 一致 |
| `sse` | `string` | 已 `formatSSE` 的完整片段，可直接 `write` 重放 |

### 3.2 `StreamSession`

| 字段 | 类型 | 说明 |
|------|------|------|
| `streamId` | `string` | 会话 ID（如 UUID） |
| `guestId` | `string` | 访客 ID，续传时与请求校验 |
| `seq` | `number` | 已分配的最大序号（与最后一条 `BufferedEvent.seq` 一致） |
| `events` | `BufferedEvent[]` | 有序缓冲 |
| `status` | `"running" \| "done" \| "error"` | 流状态 |

### 3.3 `StreamSessionStore` 接口

与 [design.md 第 10 节](./design.md) 一致，异步契约便于 M8 Redis：

```ts
interface StreamSessionStore {
  create(guestId: string): Promise<StreamSession>;
  get(streamId: string): Promise<StreamSession | null>;
  appendEvent(
    streamId: string,
    ev: BufferedEvent,
    opts: { maxEvents: number; maxBytes: number }
  ): Promise<{ dropped: number }>;
  markDone(streamId: string): Promise<void>;
  markError(streamId: string): Promise<void>;
}
```

**工厂**：`getStreamSessionStore()`（按 env 在 M7 仅返回内存实现，M8 可选 Redis）。

---

## 4. 内存实现（M7）

- **文件建议**：`lib/sseServer/streamSession.memory.ts`（或合并入 store 模块的子导出）。
- **职责**：替代 `streamSession.ts` 中顶层 `sessions` `Map`；实现 TTL / 延迟清理（与现有 `CLEANUP_MS` 语义对齐）。
- **回归**：在 **未触发 5A** 时，与当前「无界缓冲直至清理」行为一致；可通过默认 `maxEvents` / `maxBytes` 足够大或测试环境专用配置保证单测/验收稳定。

---

## 5. 5A（缓冲上限）

- **条数**：`maxEvents`；
- **字节**：对 `sse` 的 UTF-8 字节长度累计（推荐 `TextEncoder`），与项目统一规则保持一致；
- **超限**：从 **`events` 队列头部**丢弃最旧事件，直至满足双上限，再追加新事件；
- **可观测性**：通过 `chatLog` 记录丢弃（如 `buffer_trimmed`），字段含 `streamId`、`dropped`、原因；
- **返回值**：`appendEvent` 返回 `{ dropped: number }`（本次丢弃条数，或累计，需在实现中约定并在日志中一致）。

上限来源：**M1** 集中配置（`lib/chat/limits.ts` 及 `CHAT_*` env）；若尚未存在缓冲专用键，实现阶段新增并与 design 对齐。

---

## 6. SSE 适配（M9）

### 6.1 `createSSEWriter`

- 入参除现有 `session`、`encoder`、`writerRef` 外，增加 **`StreamSessionStore`** 与 **`opts`（maxEvents / maxBytes）**（或从 `getChatLimits()` 读取）。
- 每次写入：`session.seq += 1` → 生成 `id`、`sse` → **`await store.appendEvent(streamId, { seq, id, sse }, opts)`**；
- 随后仍尝试向 `writerRef.current` 写入（失败则置空，与现逻辑一致：断线继续缓冲）。

**一致性**：`seq` 可由 writer 递增；`appendEvent` 内须与会话内 `seq` / `events` 保持同一真源（以 store 为准）。

### 6.2 `replayAndFollow`

- 会话数据以 **store 为真源**；
- 实现可选：每轮循环 **`await store.get(streamId)`** 获取最新 `events` / `status`，或内存实现返回稳定引用以减少分配；
- 轮询间隔与现 `replayAndFollow` 行为保持一致（如 50ms），直至 `status !== "running"`。

### 6.3 生命周期

- `markSessionDone` / `markSessionError` → 对应 **`store.markDone`** / **`store.markError`**，并保留延迟从 store 移除会话的行为。

### 6.4 对外导出

- `parseEventId`、`formatSSE` 不变；
- `getStreamSession` 可薄封装为 **`getStreamSessionStore().get(...)`**，便于 `app/api/chat/route.ts` 在 M10 前少改调用点（具体以实现为准）。

---

## 7. 模块与文件建议

| 文件 | 职责 |
|------|------|
| `lib/sseServer/streamSessionStore.ts` | `StreamSessionStore` 接口、类型导出、`getStreamSessionStore()` |
| `lib/sseServer/streamSession.memory.ts` | M7 内存实现 |
| `lib/sseServer/streamSession.ts` | `parseEventId`、`createSSEWriter`、`replayAndFollow`、与 store 协作；移除裸 `Map` 或委托给内存 store |

M8：`lib/sseServer/streamSession.redis.ts`。

---

## 8. 性能与安全

- **性能**：内存路径追加 O(1)；5A 裁剪时避免全表重复扫描；续传避免每 tick 深拷贝大数组。
- **安全**：续传分支继续校验 `guestId`（见 `route.ts`）；store 不暴露跨 `guestId` 的读取。

---

## 9. 风险与应对

| 风险 | 可能性 | 影响 | 应对 |
|------|--------|------|------|
| 5A 丢头导致客户端与早期 seq 不一致 | 中 | 中 | 协议文档说明以实际收到事件为准；日志带 `dropped`；覆盖超长流用例 |
| 异步 `appendEvent` 与顺序假设 | 低 | 中 | 单 writer 场景保持 `await`；内存实现顺序完成 |
| store 与本地 `session` 副本不一致 | 中 | 高 | 明确唯一真源为 store；`replayAndFollow` 只读 store |

---

## 10. 文档版本

| 日期 | 说明 |
|------|------|
| 2026-04-03 | 初版：M6/M7/M9 设计与 5A、文件划分 |
| 2026-04-03 | 实现落地：见 [implementation-summary-m6-m9.md](./implementation-summary-m6-m9.md)、[acceptance-m6-m9.md](./acceptance-m6-m9.md) |
