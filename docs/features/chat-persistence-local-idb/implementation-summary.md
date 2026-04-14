# 本机聊天持久化 — 实现总结

## 实现概述

在仅本机、同浏览器前提下，使用 **IndexedDB**（`idb-keyval`）持久化 `chatStore` 中的会话与消息；刷新后恢复 UI，与 **M8** SSE 会话存储解耦；登出、`apiFetch` 401 与用户确认清空时删除快照并清空内存 store。

## 涉及的文件

| 文件 | 作用 |
|------|------|
| `package.json` | 新增依赖 `idb-keyval` |
| `lib/chat/chatPersistence.ts` | 快照读写、`schemaVersion`、流式保存守卫、加载时孤儿空 assistant 规范化 |
| `store/chatStore.ts` | `_persistenceHydrated`、`hydrateFromPersistence`、`clearAllConversations` |
| `components/chat/ChatPersistenceProvider.tsx` | 挂载 hydrate、防抖订阅写回、`beforeunload` flush |
| `app/layout.js` | 用 `ChatPersistenceProvider` 包裹 `ChatPanel` |
| `components/chat/ChatPanel.tsx` | `createConversation` 仅在 `_persistenceHydrated` 后为真时执行 |
| `components/auth/SignOutButton.js` | `onSubmit` 中 `await clearChatPersistence()` 后清草稿与 store，再 `signOutAction` |
| `lib/http/apiFetch.ts` | 401 处理中同样 `await clearChatPersistence()` 与 `clearAllConversations` |
| `components/chat/ConversationList.tsx` | 橡皮擦按钮：确认后清空 IDB、草稿、store |
| `docs/features/chat-persistence-local-idb/design.md` | 实现状态勾选更新 |
| `docs/features/chat-persistence-local-idb/acceptance.md` | 验收步骤 |
| `PROJECT_CONTEXT.md` | 技术栈与目录、接口说明更新 |

## 新增接口（模块级）

### `loadSnapshot(): Promise<ChatPersistenceSnapshot | null>`

- **作用**：从 IndexedDB 读取快照；`schemaVersion` 不匹配则删键并返回 `null`。
- **输出**：`ChatPersistenceSnapshot` 或 `null`；`indexedDB` 不可用时返回 `null`。

### `saveSnapshot(state): Promise<void>`

- **输入**：`{ conversations, activeId, chatState }`。
- **作用**：若 `chatState !== "idle"`，在**序列化副本**中将当前 `activeId` 会话最后一条 assistant 标为 `streamStopped`，再写入。

### `clearChatPersistence(): Promise<void>`

- **作用**：删除快照键；失败静默。

### `ChatStore` 新增

- `setPersistenceHydrated(done: boolean)`
- `hydrateFromPersistence({ conversations, activeId })` — 强制 `chatState: "idle"`
- `clearAllConversations()` — 清空列表与 `activeId`

## 依赖关系

```
ChatPersistenceProvider → loadSnapshot / saveSnapshot → idb-keyval
                       → useChatStore (hydrate / subscribe)
SignOutButton / apiFetch / ConversationList → clearChatPersistence + chatDraftStorage + useChatStore
```

## 决策记录

- **登出表单**：使用 `onSubmit` + `preventDefault` + `await signOutAction()`，避免将客户端异步逻辑误当作 Server Action 传给 `action=`。
- **apiFetch 与 zustand**：401 分支仅在 `window` 存在且路径为同源业务 API 时触发，不会在服务端误调 `useChatStore`。
- **beforeunload**：异步 IDB 写入可能无法在页面卸载前完成；已尽力 `flush`，接受残余风险。

## 后续待办（可选）

- 单会话消息条数上限或裁剪策略。
- Vitest + fake-indexeddb 对 `chatPersistence` 纯函数与 schema 做单元测试。
