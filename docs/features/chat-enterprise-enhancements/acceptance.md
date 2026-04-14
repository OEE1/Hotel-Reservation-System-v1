# 聊天增强 M1–M4 验收指南

依据实现：[design-m1-m4.md](./design-m1-m4.md)。当前 **`app/api/chat/route.ts` 尚未串联 M3/M4**（设计约定在 M10 串联），故下列「接口级」验收可在 **引入 route 串联后** 复用；在此之前以 **模块级调用** 或临时脚本验证为主。

---

## 1. 功能验收清单

| 编号 | 功能点 | 验证方法 |
|------|--------|----------|
| M1-1 | 未设置 env 时使用默认上限 | 在服务端调用 `getChatLimits()`，应得到 `maxMessages=100`、`maxMessageChars=16000`、`maxContextChars=120000`、`keepLastTurns=20`（与 `lib/chat/limits.ts` 中 `DEFAULTS` 一致） |
| M1-2 | env 合法时覆盖默认值 | 设置 `CHAT_MAX_MESSAGES=50` 后重启进程，再次 `getChatLimits()`，`maxMessages` 应为 `50` |
| M1-3 | env 非法时回退并告警 | 设置 `CHAT_MAX_MESSAGES=abc`，`getChatLimits()` 回退为 `100`；控制台出现 **单行 JSON** 日志，`event` 为 `env_parse_failed` |
| M1-4 | tokenizer 开关 | `CHAT_TOKENIZER=1` 或 `true` 时 `isTokenizerEnabled()` 为 `true`；未设置或 `0` 时为 `false` |
| M2-1 | 结构化日志、不落全文 | 调用 `chatLog('info', 'context_trimmed', { guestId: 'test', streamId: 's1' })`，输出一行 JSON，且 **不包含** 用户 message 的完整 `content` 字段 |
| M3-1 | `mode: 'chat'` 必填 messages | `validateChatRequestBody({ messages: [] }, 'chat')` 抛 `ChatValidationError`，`code` 为 `VALIDATION_EMPTY_CONTENT`（或等价校验失败） |
| M3-2 | 条数/长度/role/content | 超限条数、单条码点超 `maxMessageChars`、`role` 非 `user`\|`assistant`、trim 后空 content，应对应 `VALIDATION_*` 错误码 |
| M3-3 | `mode: 'resume'` 可无 messages | `validateChatRequestBody({}, 'resume')` 不抛错；若带 `messages` 则仍按条数与单条规则校验 |
| M4-1 | 裁剪头部整轮 | 构造多轮消息使总算超 `maxContextChars`，但「最近 `keepLastTurns` 轮」未超：`trimMessagesToBudget` 返回 `trimmed: true` 且消息条数减少 |
| M4-2 | 尾部仍超预算 | 仅保留的尾部轮次合计仍超上限时抛 `ChatBudgetError`，`code` 为 `BUDGET_CONTEXT_EXCEEDED` |
| M4-3 | `applyBudgetOrThrow` 与 `measureMode` 一致 | 传入 `opts.mode: 'chars'` 与 `trimMessagesToBudget` 的 `measureMode: 'chars'` 行为一致；`tokens` 同理 |

---

## 2. 手动测试步骤（模块级，推荐）

1. 在项目根目录执行 `npx tsc --noEmit`，确认无类型错误。
2. **一键验收脚本**（会临时清空 `CHAT_*` 环境变量做默认值断言，结束后恢复）：
   - `npm run test:m1-m4` 或 `npx tsx scripts/m1-m4-acceptance.ts`
   - 期望输出多行 `[OK] ...`，结尾 `All passed: 9 checks`；非法 env 与裁剪会打印单行 JSON（`env_parse_failed` / `context_trimmed`），属正常。
3. 若需自写用例，可在 `scripts/` 或单元测试中 `import`：`getChatLimits`、`isTokenizerEnabled`、`chatLog`、`validateChatRequestBody`、`trimMessagesToBudget`、`applyBudgetOrThrow`。

---

## 3. HTTP / `curl` 说明（route 串联 M3/M4 之后）

在 **`POST /api/chat` 已调用 `validateChatRequestBody` 与 `applyBudgetOrThrow`** 的前提下，可用 HTTP 验证 400 与错误体。

### PowerShell 重要说明

- **`curl` 是 `Invoke-WebRequest` 的别名**，与 GNU curl 参数不兼容。请使用 **`curl.exe`** 调用系统自带的真实 curl。
- JSON 体在 PowerShell 中易因转义出错，建议 **单行** `curl.exe` + `-d "{\"key\":\"value\"}"`，或使用文件：`curl.exe -H "Content-Type: application/json" -d @body.json URL`。

### 示例（占位符需替换）

```text
curl.exe -sS -X POST "http://localhost:3000/api/chat" -H "Content-Type: application/json" -H "Cookie: YOUR_SESSION_COOKIE" -d "{\"messages\":[]}"
```

- 将 `YOUR_SESSION_COOKIE` 替换为浏览器登录后拿到的会话 Cookie（未登录期望 **401**）。
- 将 `messages` 替换为符合 `ChatRequestBody` 的合法 JSON 数组后，期望 **200**（SSE）或业务定义的 **400**（校验失败时应在 M10 映射 `ChatValidationError.code`）。

### 类 Unix（Git Bash / Linux / macOS）

可使用单引号包裹 JSON 体，减少转义问题：

```bash
curl -sS -X POST 'http://localhost:3000/api/chat' \
  -H 'Content-Type: application/json' \
  -H 'Cookie: YOUR_SESSION_COOKIE' \
  -d '{"messages":[]}'
```

---

## 4. 边界与异常

- **env 拼写错误**：静默回退到默认值，依赖 `env_parse_failed` 日志与运维配置表（见 design-m1-m4 §9）。
- **`CHAT_TOKENIZER=1`**：`CHAT_MAX_CONTEXT_CHARS` 按 **启发式 token 预算** 解释（见 `PROJECT_CONTEXT.md`），与纯码点模式不可混用同一套「经验数值」而不读文档。
- **日志**：不得依赖日志中出现用户全文；验收时检查 `chatLog` 输出中无整段用户输入。

---

## 5. 相关文档

- [design-m1-m4.md](./design-m1-m4.md)
- [PROJECT_CONTEXT.md](../../../PROJECT_CONTEXT.md)
