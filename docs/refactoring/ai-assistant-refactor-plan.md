# AI 助手模块重构规划

> 基于对当前代码的阅读与归类，供渐进式重构参考。  
> 分析范围：`app/api/chat`、`lib/sseServer/*`、`lib/sseClient/useChatStream.ts`、`lib/ai/provider.ts`、`components/chat/*`、`store/chatStore.ts`、`app/chat/page.tsx`。  
> 说明：仓库内未找到 `PROJECT_CONTEXT.md`，本规划不依赖该文件。

---

## 1. 问题识别与分类

### 1.1 安全性

| 问题 | 说明 |
|------|------|
| 服务端会话与多实例 | `StreamSession` 存于进程内存 `Map`（`lib/sseServer/streamSession.ts`），无跨实例共享。多实例或 Serverless 下断点续传可能失效；需在部署模型与续传能力间达成一致。 |
| 请求体与成本 | `POST /api/chat` 接受完整 `messages`，若缺少条数/总长度/角色校验及速率限制，存在滥用与费用风险。 |
| 上游错误透出 | `lib/ai/provider.ts` 失败时可能将上游原始文本传入 `Error`，需确认路由层是否仅向客户端返回通用文案。 |
| 工具执行 | `guestId` 由服务端注入、不经模型，有利于防 prompt 注入越权；新增工具时需保持写操作均绑定 `guestId`。 |

### 1.2 性能

| 问题 | 说明 |
|------|------|
| 续传轮询 | `replayAndFollow` 在流未结束时以约 50ms 间隔轮询，长连接下可考虑事件驱动或合并等待策略。 |
| 内存 | `StreamSession.events` 持续追加，极长流可能占用大量内存；依赖定时清理，可考虑缓冲条数/字节上限。 |
| 上下文 | 客户端 `messagesToSend` 随历史变长，需统一截断与 token 策略，避免浪费或截断不当。 |

### 1.3 可维护性

| 问题 | 说明 |
|------|------|
| 双套聊天实现 | `ChatPanel` + Zustand + `useChatStream` 为主路径；`app/chat/page.tsx` 仍用本地 state + 直接 `fetchSSE`，行为变更需改两处。 |
| 注释与路径 | `lib/sseServer/aiTools.ts` 顶部注释路径与实际不符，易误导。 |
| 类型与断言 | 如 `body.messages as never` 掩盖运行时校验缺失；停止流与 `ERROR` 状态机语义应对照 `lib/chat/stateMachine` 文档化。 |

### 1.4 可扩展性

| 问题 | 说明 |
|------|------|
| LLM 接入 | `lib/ai/provider.ts` 固定 DeepSeek URL 与模型名，切换供应商或模型需改代码。 |
| 工具集中 | 工具与 schema 集中在单文件，持续加功能时适合按业务子域拆分。 |

### 1.5 架构

| 问题 | 说明 |
|------|------|
| 分层 | Route → `handleChatStream` → `consumeLLMStream` / `executeTool` 边界清晰。 |
| 断点续传与部署 | 内存会话与多 worker / 边缘运行时天然存在张力，属架构层决策：外置存储或明确「仅单进程续传」。 |

---

## 2. 重构模块划分

每个模块应 **边界清晰、可相对独立交付、重构后可单独验证**。

| 模块名称 | 涉及文件/模块 | 主要问题 | 重构目标 | 风险等级 |
|----------|----------------|----------|----------|----------|
| API 与输入校验 | `app/api/chat/route.ts`、`types/chat.ts` | 缺少消息条数/长度/角色校验；无限流 | 服务端校验；可选按用户/IP 限流 | 中 |
| 流会话与续传 | `lib/sseServer/streamSession.ts`、resume 分支 | 内存 Map、轮询、多实例不可靠 | 明确部署假设；或 Redis 等外置存储；缓冲上限 | 高 |
| LLM 接入层 | `lib/ai/provider.ts` | 硬编码供应商与模型；错误可能过细 | 配置化（env）、统一错误映射、可测适配层 | 中 |
| 工具层 | `lib/sseServer/aiTools.ts` | 单文件膨胀、注释过时 | 按子域拆分；修正注释；统一 `executeTool` 与权限 | 中 |
| 客户端流与状态 | `lib/sseClient/useChatStream.ts`、`store/chatStore.ts`、`chatUIStore` | 与测试页逻辑重复；停止/ERROR 语义 | 单一数据流；状态机文档化 | 低～中 |
| 重复 UI 路径 | `app/chat/page.tsx` vs `components/chat/ChatPanel.tsx` | 两套 SSE 与状态 | 测试页薄封装或删除重复，业务只保留一套 | 低 |

---

## 3. 推荐重构顺序

1. **低风险、高收益**：统一 `app/chat/page.tsx` 与 `ChatPanel` 的流式逻辑（或明确测试页仅开发用并删减重复），减少后续改动面。
2. **收紧入口**：为 `/api/chat` 增加校验与限流，降低安全与费用风险。
3. **LLM 适配层**：抽象 `provider`，便于换模型与统一错误处理。
4. **工具模块拆分**：在工具继续增多前按域拆分 `aiTools`。
5. **流会话架构**：若目标为多实例/Serverless，专项做外置会话或文档化「续传仅限单实例」。

**原则**：基础优先（单一客户端路径、校验）→ 高风险/架构（会话存储）在部署目标明确后推进。

---

## 4. 当前能力小结（基线）

已实现：NextAuth 认证、`/api/chat` SSE、`handleChatStream` 工具调用轮次上限、`consumeLLMStream` 解析、内存断点续传、`useChatStream` 重试/超时/去重、Zustand 会话与状态机等。

---

## 5. 后续动作

- 确认部署形态（单实例 vs 多实例、是否依赖续传）。
- 确认 `/chat` 页面是否长期保留为独立测试入口。
- 模块级落地可配合 `module-refactor` 技能逐块细化补丁级步骤。

---

*文档生成自 refactor-planner 分析，可按评审结果迭代版本号或拆分为子任务清单。*
