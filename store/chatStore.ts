// stores/chatStore.ts
import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { chatReducer, ChatState, ChatAction } from "@/lib/chat/stateMachine";
import type { Message, Conversation, ToolCall } from "@/types/chat";

export type ToolCallStatus = ToolCall;

interface ChatStore {
  // 会话列表
  conversations: Conversation[];
  activeId: string | null;

  /** IndexedDB hydrate 完成前为 false；避免未恢复就新建会话 */
  _persistenceHydrated: boolean;
  setPersistenceHydrated: (done: boolean) => void;
  /** 从本机快照恢复（chatState 强制 idle） */
  hydrateFromPersistence: (snap: {
    conversations: Conversation[];
    activeId: string | null;
  }) => void;
  /** 清空所有会话与活动 id（登出 / 清空本地 / 401） */
  clearAllConversations: () => void;

  createConversation: () => string;
  deleteConversation: (id: string) => void;
  setActiveId: (id: string) => void;

  // 消息操作（同步方法）
  appendMessage: (msg: Message) => void;
  updateLastAssistant: (chunk: string) => void;
  /** 将最后一条助手消息全文替换（流式错误提示等） */
  setLastAssistantContent: (text: string) => void;
  appendThinking: (chunk: string) => void;
  upsertToolCall: (tool: ToolCallStatus) => void;
  /** 从当前会话末尾删除若干条消息（用于 401 回滚本次 user+assistant 占位） */
  popLastMessages: (count: number) => void;
  /** 将最后一条 assistant 标为已停止（用户 abort，未完成流） */
  markLastAssistantStreamStopped: () => void;

  // 状态机
  chatState: ChatState;
  dispatchChat: (action: ChatAction) => void;

  // 工具方法
  activeMessages: () => Message[];
}

export const useChatStore = create<ChatStore>()(
  immer((set, get) => ({
    conversations: [],
    activeId: null,

    _persistenceHydrated: false,
    setPersistenceHydrated: (done) => set({ _persistenceHydrated: done }),
    hydrateFromPersistence: (snap) =>
      set((s) => {
        s.conversations = snap.conversations;
        s.activeId = snap.activeId;
        s.chatState = "idle";
      }),
    clearAllConversations: () =>
      set((s) => {
        s.conversations = [];
        s.activeId = null;
        s.chatState = "idle";
      }),

    createConversation: () => {
      const id = crypto.randomUUID();
      set((s) => {
        s.conversations.unshift({
          id,
          title: "新对话",
          messages: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
        s.activeId = id;
      });
      return id;
    },

    deleteConversation: (id) =>
      set((s) => {
        s.conversations = s.conversations.filter((c) => c.id !== id);
        if (s.activeId === id) {
          s.activeId = s.conversations[0]?.id ?? null;
        }
      }),

    setActiveId: (id) => set((s) => { s.activeId = id; }),

    appendMessage: (msg) =>
      set((s) => {
        const conv = s.conversations.find((c) => c.id === s.activeId);
        if (!conv) return;
        conv.messages.push(msg);
        conv.updatedAt = Date.now();
        if (conv.title === "新对话" && msg.role === "user") {
          conv.title = msg.content.slice(0, 20) || "新对话";
        }
      }),

    updateLastAssistant: (chunk) =>
      set((s) => {
        const conv = s.conversations.find((c) => c.id === s.activeId);
        if (!conv) return;
        const last = [...conv.messages].reverse().find((m) => m.role === "assistant");
        if (last) last.content += chunk;
      }),

    setLastAssistantContent: (text) =>
      set((s) => {
        const conv = s.conversations.find((c) => c.id === s.activeId);
        if (!conv) return;
        const last = [...conv.messages].reverse().find((m) => m.role === "assistant");
        if (!last) return;
        last.content = text;
        conv.updatedAt = Date.now();
      }),

    appendThinking: (chunk) =>
      set((s) => {
        const conv = s.conversations.find((c) => c.id === s.activeId);
        if (!conv) return;
        const last = [...conv.messages].reverse().find((m) => m.role === "assistant");
        if (last) last.thinking = (last.thinking ?? "") + chunk;
      }),

    upsertToolCall: (tool) =>
      set((s) => {
        const conv = s.conversations.find((c) => c.id === s.activeId);
        if (!conv) return;
        const last = [...conv.messages].reverse().find((m) => m.role === "assistant");
        if (!last) return;
        if (!last.toolCalls) last.toolCalls = [];
        const idx = last.toolCalls.findIndex((t) => t.id === tool.id);
        if (idx >= 0) {
          // Keep previously received fields (like `input`) when the server sends partial updates.
          last.toolCalls[idx] = { ...last.toolCalls[idx], ...tool };
        } else {
          last.toolCalls.push(tool);
        }
      }),

    popLastMessages: (count) =>
      set((s) => {
        const conv = s.conversations.find((c) => c.id === s.activeId);
        if (!conv || count <= 0) return;
        const n = Math.min(count, conv.messages.length);
        conv.messages.splice(conv.messages.length - n, n);
        conv.updatedAt = Date.now();
      }),

    markLastAssistantStreamStopped: () =>
      set((s) => {
        const conv = s.conversations.find((c) => c.id === s.activeId);
        if (!conv) return;
        const lastAssistant = [...conv.messages].reverse().find((m) => m.role === "assistant");
        if (!lastAssistant) return;
        lastAssistant.streamStopped = true;
        conv.updatedAt = Date.now();
      }),

    chatState: "idle",
    dispatchChat: (action) =>
      set((s) => {
        s.chatState = chatReducer(s.chatState, action);
      }),

    activeMessages: () => {
      const { conversations, activeId } = get();
      return conversations.find((c) => c.id === activeId)?.messages ?? [];
    },
  }))
);