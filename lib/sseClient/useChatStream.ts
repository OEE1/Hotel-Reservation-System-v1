// lib/useChatStream.ts
// 导入 React 的 useCallback Hook，用于缓存函数，避免不必要的重新创建
import { useCallback } from "react";
// 导入聊天状态管理 store，用于操作聊天消息、状态等
import { useChatStore } from "@/store/chatStore";
// 导入认证状态 store，用于获取当前认证状态（是否登录、loading 等）
import { useAuthSessionStore } from "@/store/authSessionStore";
// 导入聊天 UI 状态 store，用于控制 UI 相关的状态（如重连提示、中断标志等）
import { useChatUIStore } from "@/store/chatUIStore";
// 导入 SSE 客户端核心函数 fetchSSE，用于与后端建立 Server-Sent Events 连接
import { fetchSSE } from "@/lib/sseClient/client";
// 导入网络错误判断、可重试错误判断、最大重试轮次、重试延迟计算函数等
import {
  isLikelyNetworkError,
  isRetryableChatError,
  MAX_RETRY_ROUNDS,
  retryDelayMs,
} from "@/lib/sseClient/retryPolicy";
// 导入 SSE 客户端选项类型和 SSE 事件类型
import type { SSEClientOptions, SSEEvent } from "@/types/sse";
// 导入消息和工具调用类型
import type { Message, ToolCall } from "@/types/chat";
// 导入聊天状态机中的动作类型
import { ChatAction } from "@/lib/chat/stateMachine";
import {
  createStreamingTextSink,
  DEFAULT_STREAMING_TEXT_MAX_DELAY_MS,
} from "@/lib/chat/streamingTextSink";

// 内部辅助函数：根据当前消息列表构建发送给后端的请求消息数组
function buildApiMessagesForRequest(messages: Message[]): Message[] {
  // 先过滤掉不需要发送的消息：
  // 1. 如果消息角色是 assistant 且标记了 streamStopped（用户中断），则不发送
  // 2. 对于 assistant 消息，若既没有有效内容也没有工具调用，也不发送
  const filtered = messages.filter((msg) => {
    if (msg.role === "assistant" && msg.streamStopped) return false;
    if (msg.role !== "assistant") return true;
    return (
      (msg.content && msg.content.trim() !== "") ||
      (msg.toolCalls && msg.toolCalls.length > 0)
    );
  });

  // 最终要发送的消息数组
  const out: Message[] = [];
  // 遍历过滤后的消息，处理连续两个 user 消息的情况（防止后端解析出错）
  for (let i = 0; i < filtered.length; i++) {
    const cur = filtered[i];
    // 如果当前是 user 消息，且上一条也是 user 消息，则在中间插入一条占位的 assistant 消息
    if (
      cur.role === "user" &&
      out.length > 0 &&
      out[out.length - 1].role === "user"
    ) {
      out.push({
        id: `api-bridge-${crypto.randomUUID()}`, // 生成唯一 ID
        role: "assistant",
        content: "（上一轮回复已停止。）", // 占位文本
        createdAt: 0,
      });
    }
    // 将当前消息加入输出数组
    out.push(cur);
  }
  return out;
}

// 内部辅助函数：将 SSE 事件类型映射为状态机的动作
function sseTypeToAction(type: SSEEvent["type"]): ChatAction | null {
  switch (type) {
    case "thinking": return { type: "THINKING" };
    case "delta": return { type: "DELTA" };
    case "tool_call": return { type: "TOOL_CALL" };
    case "done": return { type: "DONE" };
    case "error": return { type: "ERROR" };
    default: return null; // 未知类型，不触发动作
  }
}

// 内部辅助函数：执行一次 SSE 请求（不包含自动重试），返回 Promise，在连接完成或出错时 resolve/reject
function fetchSSEOnce(
  url: string,
  body: Record<string, unknown>,
  options: Omit<SSEClientOptions, "onDone" | "onError"> & {
    onEvent: SSEClientOptions["onEvent"];
  }
): Promise<void> {
  // 返回一个 Promise，在 fetchSSE 内部调用 onDone 时 resolve，onError 时 reject
  return new Promise((resolve, reject) => {
    fetchSSE(url, body, {
      ...options,
      onDone: () => resolve(),   // 流正常结束，Promise 完成
      onError: (err) => reject(err), // 出现错误，Promise 拒绝
    });
  });
}

// 导出的自定义 Hook，提供发送消息和停止消息的功能
export const useChatStream = () => {
  // 获取认证状态（只关心 status，使用选择器）
  const auth = useAuthSessionStore((s) => s.auth);
  // 获取 chatStore 的 getState 方法，以便在回调中获取最新状态
  const getChatStore = useChatStore.getState;
  // 获取 chatUIStore 的 getState 方法
  const getUIStore = useChatUIStore.getState;

  // 停止当前消息生成的方法
  const stopMessage = useCallback(() => {
    const cs = getChatStore();           // 获取当前 chat store 的状态
    const wasBusy = cs.chatState !== "idle"; // 记录之前是否处于忙碌状态
    getUIStore().bumpStreamCancelGeneration(); // 递增取消令牌，使正在进行的流被标记为取消
    getUIStore().abort();                // 中止当前的 fetch（AbortController）
    if (wasBusy) cs.markLastAssistantStreamStopped(); // 如果之前是忙碌，标记最后一条助手消息的流被停止
    cs.dispatchChat({ type: "ERROR" });  // 发送 ERROR 动作，使状态机进入错误状态
  }, [getChatStore, getUIStore]);        // 依赖这两个 store 的 getState 方法

  // 发送消息的方法（核心）
  const sendMessage = useCallback(
    async (text: string) => {
      // 获取最新的 chat store 和 ui store 状态
      const chatStore = getChatStore();
      const uiStore = getUIStore();

      // 认证状态为 loading 时，不发送消息（等待认证完成）
      if (auth.status === "loading") return;
      // 如果未认证，设置 UI 的认证阻断标志，并返回
      if (auth.status === "unauthenticated") {
        uiStore.setAuthBlocked(true);
        return;
      }
      // 认证通过，清除阻断标志
      uiStore.setAuthBlocked(false);

      // 如果当前 chat 状态不是 idle（即正在处理），则先停止当前消息
      if (chatStore.chatState !== "idle") {
        stopMessage();
      }

      // 如果没有活跃的对话，创建一个新的对话
      if (!chatStore.activeId) {
        chatStore.createConversation();
      }

      // 添加用户消息到 store
      chatStore.appendMessage({
        id: crypto.randomUUID(),
        role: "user",
        content: text,
        createdAt: Date.now(),
      });
      // 添加一个空的助手消息占位，准备接收流式内容
      chatStore.appendMessage({
        id: crypto.randomUUID(),
        role: "assistant",
        content: "",
        createdAt: Date.now(),
      });

      // 发送 START 动作，开始生成
      chatStore.dispatchChat({ type: "START" });

      // 构建要发送给后端的消息数组（去除不必要的字段，并确保格式）
      const messagesToSend = buildApiMessagesForRequest(chatStore.activeMessages()).map(
        ({ role, content, toolCalls }) => ({
          role,
          content,
          ...(toolCalls && { toolCalls }), // 如果有工具调用则包含
        })
      );

      // 用于去重的已处理事件 ID 集合
      const seenIds = new Set<string>();
      // 最后接收到的事件 ID，用于断点续传
      let lastEventId: string | undefined;
      // 获取当前的取消令牌（用于判断是否被用户停止）
      const cancelToken = getUIStore().streamCancelGeneration;

      // 辅助函数：检查是否被用户取消（令牌变化意味着取消了）
      const isSendCancelled = () =>
        getUIStore().streamCancelGeneration !== cancelToken;

      // 单次 sendMessage（含重试）共用一个 sink：delta / thinking 批量写入；401 不 flush（见方案）
      const textSink = createStreamingTextSink({
        maxDelayMs: DEFAULT_STREAMING_TEXT_MAX_DELAY_MS,
        onFlushDelta: (chunk) => getChatStore().updateLastAssistant(chunk),
        onFlushThinking: (chunk) => getChatStore().appendThinking(chunk),
      });

      // 重试循环：最多 MAX_RETRY_ROUNDS 次
      for (let round = 0; round <= MAX_RETRY_ROUNDS; round++) {
        // 如果已取消，清理重连标志和 abort 引用后返回
        if (isSendCancelled()) {
          textSink.flushAll();
          textSink.clear();
          uiStore.setStreamReconnecting(false);
          getUIStore().registerAbort(null);
          return;
        }

        // 如果是重试轮次（round > 0）
        if (round > 0) {
          // 如果没有保存的 lastEventId，则无法断点续传，提示错误后返回
          if (!lastEventId) {
            textSink.flushAll();
            textSink.clear();
            uiStore.setStreamReconnecting(false);
            const csFail = getChatStore();
            csFail.setLastAssistantContent(
              "连接中断且无法从断点续传，请重试发送。"
            );
            csFail.dispatchChat({ type: "ERROR" });
            getUIStore().registerAbort(null);
            return;
          }
          // 设置 UI 正在重连的标志
          uiStore.setStreamReconnecting(true);
          // 等待重试延迟
          await new Promise((r) => setTimeout(r, retryDelayMs(round)));
          // 等待期间可能被取消
          if (isSendCancelled()) {
            textSink.flushAll();
            textSink.clear();
            uiStore.setStreamReconnecting(false);
            getUIStore().registerAbort(null);
            return;
          }
        }

        // 是否为重试轮次（需要携带 resumeFromEventId）
        const useResume = round > 0;
        // 标志是否已清除重连提示（避免重复清除）
        let clearedReconnectHint = false;

        // 构造请求体
        const body: Record<string, unknown> =
          useResume && lastEventId
            ? { messages: messagesToSend, resumeFromEventId: lastEventId }
            : { messages: messagesToSend };

        // 创建 AbortController，用于取消本次请求
        const controller = new AbortController();
        // 将 controller 注册到 UI store，以便外部可以中断
        uiStore.registerAbort(controller);

        // SSE 事件处理函数
        const handleEvent = (event: SSEEvent) => {
          // 重连成功后收到的第一个事件，清除重连提示（避免一直显示“正在重试”）
          if (useResume && !clearedReconnectHint) {
            clearedReconnectHint = true;
            getUIStore().setStreamReconnecting(false);
          }

          // 如果事件带有 id，且已经处理过则跳过（去重）
          if (event.id) {
            if (seenIds.has(event.id)) return;
            seenIds.add(event.id);
            lastEventId = event.id; // 更新最后事件 ID
          }

          // done / error 前先落盘缓冲中的正文，再切状态机
          if (event.type === "done" || event.type === "error") {
            textSink.flushAll();
          }

          // 获取最新 chat store 状态
          const cs = getChatStore();
          // 将事件类型映射为状态机动作并派发
          const action = sseTypeToAction(event.type);
          if (action) cs.dispatchChat(action);

          // 根据不同事件类型更新 store（tool_call 前 flush，保证与工具节点顺序一致）
          switch (event.type) {
            case "thinking":
              textSink.pushThinking((event.data as { content: string }).content);
              break;
            case "delta":
              textSink.pushDelta((event.data as { content: string }).content);
              break;
            case "tool_call":
              textSink.flushAll();
              cs.upsertToolCall(event.data as ToolCall);
              break;
            default:
              break;
          }
        };

        try {
          // 执行一次 SSE 请求
          await fetchSSEOnce("/api/chat", body, {
            signal: controller.signal,
            firstByteTimeoutMs: 10_000,   // 首字节超时 10 秒
            idleTimeoutMs: 30_000,        // 空闲超时 30 秒
            onEvent: handleEvent,
          });
          // 流正常结束，清除重连标志，注销 abort 引用，返回成功
          textSink.flushAll();
          textSink.clear();
          uiStore.setStreamReconnecting(false);
          getUIStore().registerAbort(null);
          return;
        } catch (err) {
          // 出现错误，清除重连标志
          uiStore.setStreamReconnecting(false);
          // 如果是用户主动取消，直接返回
          if (err instanceof DOMException && err.name === "AbortError") {
            textSink.flushAll();
            textSink.clear();
            return;
          }

          // 检查是否是未授权错误（401）
          const isUnauthorized =
            err instanceof Error &&
            (err.message === "UNAUTHORIZED" ||
              (err as Error & { statusCode?: number }).statusCode === 401);
          if (isUnauthorized) {
            // 未授权：不 flush 缓冲（与 pop 回滚一致），仅取消定时器
            textSink.clear();
            // 未授权：移除刚刚添加的用户消息和空助手消息（回滚）
            getChatStore().popLastMessages(2);
            getChatStore().dispatchChat({ type: "ERROR" });
            getUIStore().registerAbort(null);
            getUIStore().setAuthBlocked(true); // 显示认证阻断
            return;
          }

          // 判断是否可重试的错误，且未超过最大重试次数
          if (!isRetryableChatError(err) || round >= MAX_RETRY_ROUNDS) {
            console.error("[sendMessage]", err);
            textSink.flushAll();
            const cs = getChatStore();
            // 根据不同错误类型设置不同的提示消息
            if (err instanceof Error && err.name === "SSEIncompleteError") {
              cs.setLastAssistantContent("连接中断，回复未完成，请重试。");
            } else if (isLikelyNetworkError(err)) {
              cs.setLastAssistantContent("网络异常");
            }
            cs.dispatchChat({ type: "ERROR" });
            textSink.clear();
            getUIStore().registerAbort(null);
            return;
          }
          // 下一轮续传前把缓冲写入 store，避免与后续事件错位
          textSink.flushAll();
          // 否则继续重试循环（进入下一轮）
        }
      }
    },
    [getChatStore, getUIStore, stopMessage, auth.status] // 依赖这些值
  );

  // 返回 sendMessage 和 stopMessage 供外部调用
  return { sendMessage, stopMessage };
};