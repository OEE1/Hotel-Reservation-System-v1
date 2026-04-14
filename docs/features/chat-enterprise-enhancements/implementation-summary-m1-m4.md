# 聊天增强 M1–M4 实现总结

## 实现概述

按 [design-m1-m4.md](./design-m1-m4.md) 实现服务端可复用的 **上限配置（M1）**、**结构化日志（M2）**、**请求体验证（M3）** 与 **上下文预算/裁剪（M4）**。M1 采用 **策略 B**：默认常量 + `process.env` 可选覆盖。未新增 npm 依赖；tokenizer 分支使用 **启发式 token 估算**（`ceil(码点数/4)`），可后续替换为 tiktoken 等。

**说明**：`app/api/chat/route.ts` 在总体设计中于 **M10** 串联 M3→M4；本阶段仅交付模块，路由集成待后续迭代。

---

## 涉及的文件

| 路径 | 作用 |
|------|------|
| `lib/chat/limits.ts` | 默认上限、`CHAT_ENV_KEYS`、`parsePositiveInt`、非法 env 告警、`getChatLimits()`、`isTokenizerEnabled()`、`ChatErrorCode` |
| `lib/observability/chatLog.ts` | 单行 JSON 日志 `chatLog(level, event, fields)`，禁止默认打印全文 content |
| `lib/chat/validateRequest.ts` | `ChatValidationError`、`validateChatRequestBody(body, mode)` |
| `lib/chat/budget.ts` | `countCodePoints`、`estimateTokensApprox`、`splitIntoTurns`、`trimMessagesToBudget`、`applyBudgetOrThrow`、`ChatBudgetError` |
| `PROJECT_CONTEXT.md` | 项目约定与 M1–M4 规则索引 |
| `scripts/m1-m4-acceptance.ts` | 模块级验收脚本；`npm run test:m1-m4` |
| `package.json` | `test:m1-m4` 脚本 |

---

## 新增接口与类型

### `lib/chat/limits.ts`

- **`CHAT_ENV_KEYS`**：`MAX_MESSAGES`、`MAX_MESSAGE_CHARS`、`MAX_CONTEXT_CHARS`、`KEEP_LAST_TURNS`、`TOKENIZER`（对应环境变量名字符串）。
- **`ChatErrorCode`**：  
  `VALIDATION_TOO_MANY_MESSAGES` | `VALIDATION_MESSAGE_TOO_LONG` | `VALIDATION_INVALID_ROLE` | `VALIDATION_EMPTY_CONTENT` | `BUDGET_CONTEXT_EXCEEDED` | `BUDGET_CONTEXT_STILL_EXCEEDED_AFTER_TRIM`
- **`getChatLimits(): ChatLimits`**  
  - 返回：`maxMessages`、`maxMessageChars`、`maxContextChars`、`keepLastTurns`。  
  - 服务端读取 `process.env`；非法值回退默认并打 `env_parse_failed`。
- **`isTokenizerEnabled(): boolean`**  
  - `CHAT_TOKENIZER` 为 `1` 或 `true` 时为真。

### `lib/observability/chatLog.ts`

- **`chatLog(level: 'info' \| 'warn' \| 'error', event: string, fields?: ChatLogFields): void`**  
  - 输出单行 JSON，含 `timestamp`（ISO）；`fields` 可含 `guestId`、`streamId`、`reason`、`code`、`contentLength` 等，**不应**传入完整用户正文。

### `lib/chat/validateRequest.ts`

- **`class ChatValidationError extends Error`**  
  - **`code: ChatErrorCode`**
- **`validateChatRequestBody(body: ChatRequestBody, mode: 'chat' \| 'resume'): void`**  
  - **`chat`**：`messages` 必填且非空；逐条 `role` 为 `user` \| `assistant`；trim 后 content 非空；条数 ≤ `maxMessages`；单条码点长度 ≤ `maxMessageChars`。  
  - **`resume`**：可无 `messages`；若提供则与上同。  
  - **异常**：抛出 `ChatValidationError`（无 HTTP 状态码；由调用方映射 400）。

### `lib/chat/budget.ts`

- **`countCodePoints(s: string): number`**：Unicode 码点长度。  
- **`estimateTokensApprox(s: string): number`**：启发式 token 数。  
- **`splitIntoTurns(messages: Message[]): Message[][]`**：以 `user` 起始分段为「轮」。  
- **`trimMessagesToBudget(messages, policy): { messages, removedCount, trimmed }`**  
  - **`policy`**：`maxContextChars`、`keepLastTurns`、`preserveSystem`（占位）、可选 **`measureMode`**（`'chars' \| 'tokens'`，未传时与 `isTokenizerEnabled()` 一致）。  
  - **异常**：`ChatBudgetError`（`BUDGET_CONTEXT_EXCEEDED` 等）。  
  - **日志**：裁剪成功 `context_trimmed`；拒绝 `context_rejected`。  
- **`applyBudgetOrThrow(messages, opts: { mode: 'chars' \| 'tokens' }): { messages, trimmed }`**  
  - 先判断是否超预算，超则走 `trimMessagesToBudget`（传入相同 `measureMode`）。  
  - **异常**：`ChatBudgetError`。

---

## 接口依赖关系

```
limits ─────────────────┐
   ▲                    │
   │ parse 失败          │ getChatLimits / isTokenizerEnabled
chatLog ◄────────────────┤
                         │
validateRequest ──► getChatLimits
budget ───────────► getChatLimits, isTokenizerEnabled, chatLog
                   └──► types/chat (Message)
```

---

## 重要决策记录

1. **计量统一**：校验与预算默认使用 **Unicode 码点**（`[...str].length`），与 design「单条长度」一致。  
2. **`CHAT_TOKENIZER=1`**：不引入 tiktoken 等 npm 包；使用 **启发式** `ceil(码点数/4)`；启用时 **`maxContextChars` 数值按 token 预算解释**（见 `PROJECT_CONTEXT.md`）。  
3. **`BUDGET_CONTEXT_STILL_EXCEEDED_AFTER_TRIM`**：在 `trimMessagesToBudget` 尾部防御性检查中抛出，正常数据流在尾部已保证不超预算时不应命中。  
4. **路由未改**：与 design-m1-m4 §7 一致，避免与 M10 职责重叠。

---

## 后续待办（可选）

- 在 **M10** 于 `app/api/chat/route.ts` 串联 `validateChatRequestBody` → `applyBudgetOrThrow`，并将 `ChatValidationError` / `ChatBudgetError` 映射为 **400** 与稳定 `code` 字段。  
- 若生产需要精算 token：在 `budget.ts` 中替换 `estimateTokensApprox`，并评估是否增加 `serverExternalPackages` 等 Next 配置。  
- 单元测试：为 `validateRequest`、`budget` 核心分支补充测试（若项目引入测试框架）。

---

## 验收文档

- [acceptance.md](./acceptance.md)
