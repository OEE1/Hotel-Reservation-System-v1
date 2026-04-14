# 聊天增强（企业向）M1–M4 技术设计

依据 [module-decomposition.md](./module-decomposition.md) 与 [design.md](./design.md)。  
**M1 配置策略（已确认）**：**B — 代码常量 + `process.env` 可选覆盖，未设置时使用默认常量。**

---

## 1. 总体架构（M1–M4）

```
                    ┌─────────────────────────────────────┐
                    │ M1 lib/chat/limits (+ codes/types) │
                    └──────────────┬──────────────────────┘
                                   │
         ┌─────────────────────────┼─────────────────────────┐
         ▼                         ▼                         ▼
  ┌─────────────┐          ┌──────────────┐          ┌──────────────┐
  │ M2 chatLog  │          │ M3 validate  │          │ M4 budget    │
  └─────────────┘          └──────────────┘          └──────────────┘
```

- **M1**：条数、单条长度、总上下文、保留轮数、错误码；**默认值 + env 覆盖**见第 8 节。
- **M2**：单行 JSON 结构化日志（design 6A）。
- **M3**：`ChatRequestBody` 校验（5C）。
- **M4**：2C 计量 + 3B 裁剪；依赖 M1。

---

## 2. M1：共享常量、类型与环境覆盖（策略 B）

### 2.1 原则

- 所有上限在 **`lib/chat/limits.ts`** 中定义默认常量（`as const`）。
- 同名 **`process.env`** 仅在服务端读取；未设置或解析失败则 **回退默认值**。
- env 名称集中枚举在文件顶部注释或 `CHAT_ENV_KEYS` 对象，避免散落字符串。

### 2.2 建议 env 键（示例）

| 含义 | 默认（示例） | env 键 |
|------|--------------|--------|
| 最大消息条数 | 100 | `CHAT_MAX_MESSAGES` |
| 单条 content 最大字符 | 16000 | `CHAT_MAX_MESSAGE_CHARS` |
| 合并上下文最大字符 | 120000 | `CHAT_MAX_CONTEXT_CHARS` |
| 保留最近轮数（3B） | 20 | `CHAT_KEEP_LAST_TURNS` |
| 是否启用 tokenizer 精算（2C） | 0 | `CHAT_TOKENIZER`（0/1） |

解析：`parsePositiveInt(env, fallback)`，非法则使用 fallback 并可选 `chatLog('warn', …)`。

---

## 3. M2：结构化日志

- 路径：`lib/observability/chatLog.ts`。
- 单行 JSON；字段至少含 `event`、`timestamp`（可选 ISO）、以及 `guestId` / `streamId` / `reason` / `code` 中业务相关子集。
- **禁止**默认打印完整 `content`；可记录 `contentLength`。

---

## 4. M3：请求体验证

- 路径：`lib/chat/validateRequest.ts`。
- **`mode: 'chat'`**：`messages` 必填、非空数组；逐条校验 role（与当前 `Message` 一致：`user` | `assistant`）、trim 后 content 非空、长度 ≤ M1 单条上限。
- **`mode: 'resume'`**：允许仅 `resumeFromEventId`；若同时带 `messages` 则仍按条数/长度校验（与现 route 扩展一致）。
- 错误类型：`ChatValidationError`，含 `code: ChatErrorCode`，供 route 映射 400。

---

## 5. M4：上下文预算

- 路径：`lib/chat/budget.ts`。
- **估算**：默认 `chars`（码点长度或 UTF-16 策略统一文档化）；`CHAT_TOKENIZER=1` 时再走 tokenizer 分支。
- **裁剪（3B）**：保留 system（未来扩展）；从头部删**整轮**直至低于 `maxContextChars`，且保留最近 `keepLastTurns` 轮；删后仍超则抛 `BUDGET_CONTEXT_STILL_EXCEEDED_AFTER_TRIM`。
- 裁剪或拒绝时调用 M2 记 `context_trimmed` / `context_rejected`。

---

## 6. 性能与安全

- M3/M4 线性扫描；上限由 M1 约束。
- 日志不落全文用户输入。

---

## 7. 对现有代码的影响

- `types/chat.ts` 暂不强制改；M4 预留 `system` 行为待 API 扩展。
- `route.ts` 在 M10 中串联 M3→M4；本文件仅设计约定。

---

## 8. 接口草案（伪代码）

```ts
// M1
export function getChatLimits(): {
  maxMessages: number;
  maxMessageChars: number;
  maxContextChars: number;
  keepLastTurns: number;
};

export type ChatErrorCode =
  | 'VALIDATION_TOO_MANY_MESSAGES'
  | 'VALIDATION_MESSAGE_TOO_LONG'
  | 'VALIDATION_INVALID_ROLE'
  | 'VALIDATION_EMPTY_CONTENT'
  | 'BUDGET_CONTEXT_EXCEEDED'
  | 'BUDGET_CONTEXT_STILL_EXCEEDED_AFTER_TRIM';

// M2
export function chatLog(level: 'info' | 'warn' | 'error', event: ChatLogEvent, fields: Record<string, unknown>): void;

// M3
export function validateChatRequestBody(body: ChatRequestBody, mode: 'chat' | 'resume'): void;

// M4
export function trimMessagesToBudget(messages: Message[], policy: { maxContextChars: number; keepLastTurns: number; preserveSystem: boolean }): { messages: Message[]; removedCount: number; trimmed: boolean };
export function applyBudgetOrThrow(messages: Message[], opts: { mode: 'chars' | 'tokens' }): { messages: Message[]; trimmed: boolean };
```

---

## 9. 风险与应对

| 风险 | 可能性 | 影响 | 应对 |
|------|--------|------|------|
| env 拼写错误导致静默回退 | 中 | 中 | 启动时可选校验已知 keys；文档列出表格 |
| 默认值过严 | 中 | 中 | 用 env 调大；看 `context_rejected` 日志 |

---

## 10. 文档版本

| 日期 | 说明 |
|------|------|
| 2026-04-01 | 初版；M1 策略确认为 **B** |
