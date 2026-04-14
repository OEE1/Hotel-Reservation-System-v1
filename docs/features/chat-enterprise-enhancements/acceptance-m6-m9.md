# M6–M9 验收（续传存储）

## 功能验收清单

| 项 | 验证方式 |
|----|----------|
| 新聊天流可完成 | 登录后发起聊天，正常收 SSE 至 `done` |
| 续传可工作 | 断开或携带 `resumeFromEventId` 重连，能补发未确认事件 |
| 5A 日志 | 将 `CHAT_BUFFER_MAX_EVENTS=2` 临时调低，长流触发后日志含 `buffer_trimmed` |

## 手动测试（PowerShell）

- 本机 **PowerShell** 中 **`curl` 是 `Invoke-WebRequest` 别名**，请使用 **`curl.exe`** 调用真实 curl；Linux/macOS/Git Bash 可用 `curl`。

### 1. 登录与 Cookie

在浏览器登录后，从开发者工具复制会话 Cookie（或按项目既有方式获取），将 `YOUR_COOKIE` 替换为 `Cookie:` 头内容。

### 2. POST 新聊天（示例）

```text
curl.exe -sS -X POST "http://localhost:3000/api/chat" -H "Content-Type: application/json" -H "Cookie: YOUR_COOKIE" -d "{\"messages\":[{\"role\":\"user\",\"content\":\"hi\"}]}"
```

应返回 `text/event-stream` 流（非 JSON 错误页）。

### 3. 续传（需有效 `resumeFromEventId`）

将上一次 SSE 某行的 `id:` 作为 `resumeFromEventId`：

```text
curl.exe -sS -X POST "http://localhost:3000/api/chat" -H "Content-Type: application/json" -H "Cookie: YOUR_COOKIE" -d "{\"resumeFromEventId\":\"STREAM_ID:SEQ\"}"
```

无效 id → 400；过期会话 → 404；他人 `guestId` → 403。

## 边界条件

- **缓冲顶满**：极小 `CHAT_BUFFER_MAX_EVENTS` / `CHAT_BUFFER_MAX_BYTES` 下，旧事件被丢弃，续传可能从较晚 seq 开始；属 5A 预期。

## 自动化

- `npx tsc --noEmit`、`npm run build` 通过即类型与构建侧通过。
- **脚本验收**（不启动 Next，纯 Node）：`npm run test:m6-m9`（即 `npx tsx scripts/m6-m9-acceptance.ts`）。脚本内为 `crypto.randomUUID` 做了与 Node/tsx 兼容的 polyfill；成功时输出 `All passed: 7 checks`。触发 5A 时会向 stderr 打印一行 `buffer_trimmed` JSON，属预期。
