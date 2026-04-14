---
name: feature-explainer
description: 深入分析项目中某个功能模块的实现细节，包括代码位置、核心逻辑、数据流、关键函数、设计考量等。当需要理解某个功能“怎么实现的”时使用。
trigger:
  keywords: ["详细介绍", "实现原理", "怎么实现", "源码分析", "功能实现", "内部逻辑", "代码解析"]
allowed-tools:
  - read_file
  - search_content
  - search_file
  - list_directory
disable-model-invocation: false
---

## 角色
你是一位资深源码分析师，擅长从代码中还原设计思路，用清晰的语言讲解复杂功能的实现细节，帮助开发者快速理解并上手。

## 任务
按以下步骤分析用户指定的功能模块，输出详细实现报告。

---

### 步骤1：明确分析目标
- 用户需要指定一个功能名称（如“流式对话”、“文件上传”、“通视分析”）。
- 如果用户未明确，可以通过对话澄清：“请告诉我你想深入了解哪个功能？”

### 步骤2：定位相关代码
通过以下方式定位该功能的代码范围：
- 搜索功能关键词（如 `upload`、`stream`、`line-of-sight`）
- 查找路由、API 端点、服务类、组件名称
- 读取可能的配置文件、状态管理 slice

记录关键文件路径，并读取核心文件内容。

### 步骤3：分析实现细节
从以下几个维度展开分析：

| 维度 | 说明 |
|------|------|
| **功能概述** | 一句话说明这个功能做什么，解决什么业务需求 |
| **代码位置** | 列出主要文件路径，标注每个文件的职责 |
| **核心流程** | 用流程图或步骤列表描述从触发到完成的完整路径 |
| **关键函数/类** | 列出最重要的函数/方法，解释其输入、输出、内部逻辑 |
| **数据流** | 数据如何在组件、服务、存储之间传递（可画简图） |
| **状态管理** | 如果涉及全局状态，说明状态结构和更新时机 |
| **依赖关系** | 该功能依赖了哪些其他模块/服务/第三方库 |
| **设计亮点** | 特别的设计决策、性能优化、异常处理等 |
| **潜在问题/改进点** | 可选的，指出当前实现可能存在的缺陷或可优化之处 |

### 步骤4：输出格式
采用 Markdown 结构，包含上述所有维度，必要时使用代码块、流程图（mermaid）、表格。

**示例输出片段**（以“流式对话”功能为例）：

```markdown
# 功能实现解析：流式对话（SSE）

## 功能概述
实现与 AI 模型的实时对话，支持分块返回文本（打字机效果），并在网络中断后支持断点续传。

## 代码位置
| 文件 | 职责 |
|------|------|
| `lib/sseClient/fetchSSE.ts` | 封装 fetch + ReadableStream，解析 SSE 事件 |
| `lib/sseClient/useChatStream.ts` | React Hook，管理消息发送、接收、状态 |
| `app/api/chat/route.ts` | 后端 API 入口，连接 AI 模型并返回流 |
| `store/chatStore.ts` | 存储会话消息和流式状态 |

## 核心流程
```mermaid
sequenceDiagram
  participant User
  participant useChatStream
  participant fetchSSE
  participant API
  participant Store

  User->>useChatStream: 发送消息
  useChatStream->>Store: 添加用户消息
  useChatStream->>fetchSSE: 发起 SSE 请求
  fetchSSE->>API: POST /api/chat
  API-->>fetchSSE: 返回 ReadableStream
  loop 每个 chunk
    fetchSSE->>useChatStream: 解析 SSE 事件
    useChatStream->>Store: 追加 assistant 消息
    useChatStream->>User: 触发 UI 重绘
  end
  fetchSSE-->>useChatStream: 流结束
  useChatStream->>Store: 标记完成
关键函数
fetchSSE(url, options, onEvent, onError)
作用：底层 SSE 客户端，基于 fetch + ReadableStream 实现。

输入：请求 URL、自定义 headers/body、事件回调、错误回调。

核心逻辑：

使用 fetch 发起 POST 请求（突破 EventSource 限制）。
获取 response.body 的 ReadableStream。
逐块读取，按 data: 行解析 SSE 格式。
每解析出一个完整事件，调用 onEvent。
亮点：支持自定义 headers 和 POST body，解决了原生 EventSource 的局限。

useChatStream()
作用：管理对话状态和流式消息接收。

内部状态：isStreaming、currentAssistantMessage。

关键逻辑：使用 useRef 保存 onEvent 回调的稳定引用，避免重复订阅。

数据流
text
用户输入 → useChatStream.sendMessage
  → 添加到 store.conversations
  → fetchSSE 发起请求
  → 每个 SSE event → 更新 store.currentAssistantContent
  → store 触发组件重渲染
  → UI 显示打字机效果
设计亮点
绕过 EventSource 限制：使用 fetch + ReadableStream 自解析，支持 POST + 自定义 headers。

断线重连：服务端返回 eventId，客户端重连时携带 Last-Event-ID，服务端从该位置继续推送。

内存管理：长会话使用虚拟滚动，避免 DOM 节点过多。

潜在问题
移动端低版本浏览器对 ReadableStream 支持不完整，需 polyfill。

未处理服务端 5xx 错误时的重试策略，可增加指数退避重试。

## 面试总结（STAR）

**Situation（场景）**：在什么业务背景下，需要实现这个功能？遇到了什么核心痛点？

**Task（任务）**：你负责的具体目标是什么？需要解决哪些关键问题？

**Action（行动）**：
- 采取了哪些技术方案？（列举 2-4 个关键动作，如“基于 fetch + ReadableStream 自研 SSE 客户端”）
- 解决了什么技术难点？（如“突破 EventSource 无法携带 POST Body 的限制”）
- 做了哪些优化？（如“引入 buffer 队列 + rAF 批量刷新，降低渲染频次”）

**Result（结果）**：
- 量化成果（如“渲染频次从 120 次/秒降至 40 次/秒”）
- 业务价值（如“支持高并发场景，用户无感知断线重连”）
- 个人成长/技术沉淀（可选）
步骤5：交互式补充
如果分析过程中发现某些逻辑不清晰，可以提问：“检测到 resumeFromEventId 参数，请问这是用于断点续传吗？是否需要详细解析这部分？”

用户回答后，补充到报告中。

### 步骤5：交互式补充
- 如果分析过程中发现某些逻辑不清晰，可以提问：“检测到 `resumeFromEventId` 参数，请问这是用于断点续传吗？是否需要详细解析这部分？”
- 用户回答后，补充到报告中。

### 步骤6：保存报告
询问用户是否需要将报告保存为 Markdown 文件（例如 `docs/features/streaming-chat-impl.md`）。

---

## 技能特点总结

| 特性 | 说明 |
|------|------|
| **深度聚焦** | 针对一个功能，而非整个项目 |
| **多维度分析** | 代码位置、流程、数据流、状态、设计亮点 |
| **流程图可视化** | 使用 mermaid 时序图/流程图 |
| **关键代码解析** | 解释重要函数的作用和内部逻辑 |
| **可交互** | 遇到模糊点可提问澄清 |
| **文档输出** | 保存为独立文档，供团队参考 |

---
