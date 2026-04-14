# M5 限流验收指南

## 自动化脚本（推荐）

项目根目录：

```bash
npm run test:m5
```

等价于 `npx tsx scripts/m5-acceptance.ts`。脚本会**临时清空** `REDIS_*` / Upstash 相关 env 做 fail-open 与 strict 断言，结束后恢复。

- 默认输出若干 `[OK]`，结尾 `All passed: 4 checks`（无 Redis 时跳过 live 段）。
- **真实 Redis 429 探测**：先在本机环境变量中配置好 `REDIS_URL`（或 Upstash 两项），再执行（Node 20+ 可从文件注入）：

```powershell
$env:M5_LIVE_REDIS = "1"
$env:REDIS_URL = "redis://127.0.0.1:6379"
npm run test:m5
```

或使用 **`node --env-file=.env.local`** 将 `.env.local` 载入后再跑 `tsx`（需 Node 20.6+），以便 `saved` 能读到 Redis 配置。

---

## 功能验收清单

| 编号 | 功能点 | 验证方法 |
|------|--------|----------|
| M5-1 | 无 Redis 时放行 | 不配置 `REDIS_URL` / Upstash 变量；已登录请求 `POST /api/chat` 应仍进入后续逻辑（控制台可有 `redis_unavail` warn JSON） |
| M5-2 | strict 无 Redis 503 | 设置 `CHAT_RATE_LIMIT_STRICT=1` 且无 Redis；期望 **503**，`code: REDIS_UNAVAILABLE` |
| M5-3 | 限流 429 | 配置 Redis，将 `CHAT_RATE_LIMIT_USER_MAX=1`、`CHAT_RATE_LIMIT_WINDOW_MS=60000`；同一 `guestId` 连续两次聊天请求，第二次期望 **429**，`code: RATE_LIMIT_USER`，响应含 **`Retry-After`** |
| M5-4 | 先 user 后 IP | user 未命中时，用多 IP或调低 `CHAT_RATE_LIMIT_IP_MAX` 验证 IP 维度 429（`RATE_LIMIT_IP`） |

## 手动测试步骤

1. `npm run build` 通过；本地 `npm run dev`。
2. 配置本地或云端 Redis（或 Upstash），写入 `.env.local` 后**重启** dev。
3. 浏览器登录后，用开发者工具复制 **Cookie**，用 **`curl.exe`**（PowerShell 勿用别名 `curl`）带 Cookie 调 `POST /api/chat`。

### PowerShell 说明

- 使用 **`curl.exe`**，不是 `Invoke-WebRequest` 别名。
- JSON 建议单行或使用 `@body.json` 文件。

示例（占位符替换为真实 Cookie 与合法 body）：

```text
curl.exe -sS -i -X POST "http://localhost:3000/api/chat" -H "Content-Type: application/json" -H "Cookie: YOUR_SESSION_COOKIE" -d "{\"messages\":[{\"id\":\"1\",\"role\":\"user\",\"content\":\"hi\",\"createdAt\":1}]}"
```

### 类 Unix（Git Bash / Linux / macOS）

```bash
curl -sS -i -X POST 'http://localhost:3000/api/chat' \
  -H 'Content-Type: application/json' \
  -H 'Cookie: YOUR_SESSION_COOKIE' \
  -d '{"messages":[{"id":"1","role":"user","content":"hi","createdAt":1}]}'
```

## 边界条件

- **`TRUST_PROXY=1`**：仅在受控反向代理后启用，否则易被伪造 `X-Forwarded-For`。
- **Fail-open**：Redis 宕机时无限流保护，依赖监控 `redis_unavail` 日志。

## 相关文档

- [design-m5-rate-limit.md](./design-m5-rate-limit.md)
- [implementation-summary-m5.md](./implementation-summary-m5.md)
