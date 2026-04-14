# M10 / M8 / M11 验收指南

依据实现：[implementation-summary-m10-m8-m11.md](./implementation-summary-m10-m8-m11.md)、设计 [design-m10-m8-m11.md](./design-m10-m8-m11.md)。

---

## 自动化（推荐）

### 续传脚本（内存，不依赖 Redis）

```bash
npm run test:m6-m9
```

### Vitest 集成（memory + 可选 Redis）

```bash
npm run test:integration
```

- **memory** 用例始终执行。
- **redis** 用例：仅当环境变量 **`REDIS_URL` 已设置** 时执行；否则 **skipped**（与 CI 无 Redis 场景兼容）。

在本地验证 Redis 分支示例（PowerShell）：

```powershell
$env:REDIS_URL = "redis://127.0.0.1:6379"
npm run test:integration
```

或使用 Node 20.6+ 从文件注入：

```powershell
node --env-file=.env.local ./node_modules/vitest/vitest.mjs run
```

（需 `.env.local` 中含 `REDIS_URL`。）

### 构建

```bash
npm run build
```

---

## 功能验收清单

| 编号 | 功能点 | 验证方法 |
|------|--------|----------|
| M10-1 | 编排顺序 | 代码审阅或日志：`route` 在解析 body 后调用 `validateChatRequestBody`，再 `applyBudgetOrThrow`（有 `messages` 时） |
| M10-2 | 校验 400 | 发送非法 `messages`（空、role 非法等），期望 **400** + body `code` 为 `VALIDATION_*` |
| M10-3 | 预算 400 | 构造超 `CHAT_MAX_CONTEXT_CHARS` 的上下文，期望 **400** + `code` 为 `BUDGET_*` |
| M10-4 | `store` 注入 | `handleChatStream` 与 `replayAndFollow` 使用同一 `getStreamSessionStore()` 实例（单次请求内） |
| M8-1 | 默认内存 | 不设 `CHAT_SESSION_STORE` 或设为 `memory`；续传与聊天行为与改造前一致 |
| M8-2 | Redis 会话 | `CHAT_SESSION_STORE=redis` 且配置 `REDIS_URL`（或 Upstash）；发消息 + 续传仍正常 |
| M8-3 | 独立 URL | 配置 `CHAT_SESSION_REDIS_URL` 时，会话键写入该实例（与 M5 限流键分离） |
| M11-1 | 草稿保留 | 登录 → 打开聊天 → 输入未发送文字 → 切换会话再切回，草稿仍在 |
| M11-2 | 发送清草稿 | 发送消息后，该会话对应 storage key 应清除或为空 |
| M11-3 | 登出清理 | **Sign out** 后，`sessionStorage` 中无 `wildoasis:chat:draft:` 前缀项 |
| M11-4 | 401 清理 | 触发业务 API **401**（如 `apiFetch` 路径），草稿应被清理并跳转登录 |

---

## 手动 HTTP 调试（`/api/chat`）

### PowerShell 说明（必读）

- 使用 **`curl.exe`** 调用真实 curl；**不要**使用别名 `curl`（实为 `Invoke-WebRequest`，参数不兼容）。
- JSON 建议 **单行**，或使用 `-d "@body.json"` 从文件读取，避免转义错误。

### 示例（占位符需替换）

将 `YOUR_SESSION_COOKIE` 换为浏览器里 NextAuth 会话 Cookie（开发者工具 → Application → Cookies）。

**PowerShell：**

```text
curl.exe -sS -i -X POST "http://localhost:3000/api/chat" -H "Content-Type: application/json" -H "Cookie: YOUR_SESSION_COOKIE" -d "{\"messages\":[{\"id\":\"1\",\"role\":\"user\",\"content\":\"hi\",\"createdAt\":1}]}"
```

**类 Unix（Git Bash / Linux / macOS）：**

```bash
curl -sS -i -X POST 'http://localhost:3000/api/chat' \
  -H 'Content-Type: application/json' \
  -H 'Cookie: YOUR_SESSION_COOKIE' \
  -d '{"messages":[{"id":"1","role":"user","content":"hi","createdAt":1}]}'
```

期望：已登录且 body 合法时返回 **200**，`Content-Type: text/event-stream`。

---

## 边界与异常

| 场景 | 期望 |
|------|------|
| 未登录 | **401** `Unauthorized` |
| M5 限流命中 | **429**，`code` 为 `RATE_LIMIT_USER` 或 `RATE_LIMIT_IP`，含 `Retry-After` |
| strict 无 Redis（限流） | **503** `REDIS_UNAVAILABLE` |
| 续传 `streamId` 不存在 | **404** `Session expired` |
| `guestId` 与流不匹配 | **403** `Forbidden` |

---

## 相关文档

- [design-m10-m8-m11.md](./design-m10-m8-m11.md) — 架构决策与运维条款  
- [acceptance-m5.md](./acceptance-m5.md) — M5 限流（前置步骤）  
- [acceptance-m6-m9.md](./acceptance-m6-m9.md) — 续传模块验收  
