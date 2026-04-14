/**
 * 本机对话快照（IndexedDB）。键与 M11 sessionStorage 草稿前缀区分，见 design-m10-m8-m11。
 */
import { createStore, del, get, set } from "idb-keyval";
import type { ChatState } from "@/lib/chat/stateMachine";
import type { Conversation } from "@/types/chat";

const DB_NAME = "wildoasis-chat";
const STORE_NAME = "persistence";
const SNAPSHOT_KEY = "snapshot:v1";

export const CHAT_SNAPSHOT_SCHEMA_VERSION = 1 as const;

const customStore = createStore(DB_NAME, STORE_NAME);

export interface ChatPersistenceSnapshot {
  schemaVersion: typeof CHAT_SNAPSHOT_SCHEMA_VERSION;
  savedAt: number;
  activeId: string | null;
  conversations: Conversation[];
}

function cloneConversations(conversations: Conversation[]): Conversation[] {
  return JSON.parse(JSON.stringify(conversations)) as Conversation[];
}

/** 保存前：若仍在流式中，将当前会话最后一条 assistant 标为 streamStopped，避免刷新后误拼进 API。 */
function applyStreamingGuard(
  conversations: Conversation[],
  activeId: string | null,
  chatState: ChatState
): Conversation[] {
  if (chatState === "idle" || !activeId) return conversations;
  const convs = cloneConversations(conversations);
  const conv = convs.find((c) => c.id === activeId);
  if (!conv) return convs;
  const lastAssistant = [...conv.messages].reverse().find((m) => m.role === "assistant");
  if (lastAssistant) lastAssistant.streamStopped = true;
  return convs;
}

/** 加载后：兜底处理孤儿空占位 assistant。 */
function normalizeHydratedMessages(conversations: Conversation[]): Conversation[] {
  return conversations.map((conv) => {
    const messages = conv.messages.map((m) => ({ ...m }));
    const last = messages[messages.length - 1];
    if (
      last?.role === "assistant" &&
      !last.streamStopped &&
      !last.content?.trim() &&
      !(last.toolCalls && last.toolCalls.length > 0)
    ) {
      last.streamStopped = true;
    }
    return { ...conv, messages };
  });
}

export async function loadSnapshot(): Promise<ChatPersistenceSnapshot | null> {
  if (typeof indexedDB === "undefined") return null;
  try {
    const raw = await get<unknown>(SNAPSHOT_KEY, customStore);
    if (!raw || typeof raw !== "object") return null;
    const snap = raw as Partial<ChatPersistenceSnapshot>;
    if (snap.schemaVersion !== CHAT_SNAPSHOT_SCHEMA_VERSION) {
      await del(SNAPSHOT_KEY, customStore);
      return null;
    }
    if (!Array.isArray(snap.conversations)) {
      await del(SNAPSHOT_KEY, customStore);
      return null;
    }
    return {
      schemaVersion: CHAT_SNAPSHOT_SCHEMA_VERSION,
      savedAt: typeof snap.savedAt === "number" ? snap.savedAt : Date.now(),
      activeId: typeof snap.activeId === "string" || snap.activeId === null ? snap.activeId : null,
      conversations: normalizeHydratedMessages(snap.conversations as Conversation[]),
    };
  } catch {
    return null;
  }
}

export async function saveSnapshot(state: {
  conversations: Conversation[];
  activeId: string | null;
  chatState: ChatState;
}): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  try {
    const conversations = applyStreamingGuard(
      state.conversations,
      state.activeId,
      state.chatState
    );
    const payload: ChatPersistenceSnapshot = {
      schemaVersion: CHAT_SNAPSHOT_SCHEMA_VERSION,
      savedAt: Date.now(),
      activeId: state.activeId,
      conversations,
    };
    await set(SNAPSHOT_KEY, payload, customStore);
  } catch {
    // quota / private mode
  }
}

export async function clearChatPersistence(): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  try {
    await del(SNAPSHOT_KEY, customStore);
  } catch {
    // ignore
  }
}
