# 本机聊天持久化 — 验收

## 功能验收清单

| 项 | 预期 | 验证方式 |
|----|------|----------|
| 刷新保留消息 | 登录后多轮对话，**F5 刷新**后左侧列表与消息区与刷新前一致 | 浏览器手动 |
| 不抢先建空会话 | 刷新后**不会**在 hydrate 完成前多出一个无意义的「新对话」 | 打开面板观察网络/列表（hydrate 后再补空会话仅当确实无历史） |
| 登出清空 | **Sign out** 后，再登录打开 AI 面板，**无**旧对话 | 手动 |
| 401 清空 | 触发业务 API **401**（若环境可复现），IndexedDB 快照与草稿应清理并跳转登录 | 依项目既有 M11 验收思路 |
| 清空本机 | 全屏模式下侧栏 **橡皮擦** 按钮，确认后本地对话与草稿清空 | 手动 |
| 流式中断一致性 | 生成中刷新页面，恢复后最后一条 assistant 应视为已停止，**下一轮发送**不应把半成品当完整上下文误传（由 `saveSnapshot` 守卫 + `streamStopped` 过滤保证） | 生成中长内容时刷新，再发新消息观察是否正常 |

## 手动测试步骤

1. `npm run dev`，浏览器打开站点并 **GitHub 登录**。
2. 打开右下角 AI 面板，发送至少两条用户消息并等待助手回复完成。
3. **刷新页面（F5）**，再次打开面板：对话列表与消息应仍在。
4. 打开开发者工具 → **Application** → **IndexedDB** → `wildoasis-chat` → `persistence`，确认存在键 `snapshot:v1`。
5. 点击侧栏 **橡皮擦**，确认对话框后，IndexedDB 中快照应消失或为空，面板可新建对话。
6. 再次积累对话后 **Sign out**，确认再登录后无残留对话（若需验证 IDB，可在登出后看 Application 中快照是否已删除）。

## 边界条件

- **隐私模式 / 禁用存储**：聊天仍可用，仅可能无法持久化（控制台可有 `hydrate failed` 类警告，不应白屏）。
- **极短防抖窗口内关标签**：可能丢失最后一次编辑；`beforeunload` 已尽力 flush，不保证 100% 完成异步写入。

## 集成验证

- 与现有 SSE、`useChatStream`、`buildApiMessagesForRequest` 行为一致：带 `streamStopped` 的 assistant **不参与**下一轮 API 消息拼接（见 `lib/sseClient/useChatStream.ts`）。

## 命令行说明（本功能以 UI 为主）

本验收**不依赖** curl。若你同时测试其他需 HTTP 的接口：在 **Windows PowerShell** 中请使用 **`curl.exe`** 调用真实 curl，避免 `curl` 被解析为 `Invoke-WebRequest`；JSON 体建议用单行或文件引用，减少引号转义错误。
