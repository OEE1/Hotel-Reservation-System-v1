/**
 * M11：输入框草稿按会话 id 存 sessionStorage（design-m10-m8-m11 §4A）。
 */
const PREFIX = "wildoasis:chat:draft:";

function key(conversationId: string): string {
  return `${PREFIX}${conversationId}`;
}

export function loadChatDraft(conversationId: string): string {
  if (typeof sessionStorage === "undefined") return "";
  try {
    return sessionStorage.getItem(key(conversationId)) ?? "";
  } catch {
    return "";
  }
}

export function saveChatDraft(conversationId: string, text: string): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    if (!text.trim()) {
      sessionStorage.removeItem(key(conversationId));
    } else {
      sessionStorage.setItem(key(conversationId), text);
    }
  } catch {
    // quota / private mode
  }
}

/** 登出或 401 时清空所有本会话存储下的草稿 key */
export function clearAllChatDrafts(): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k?.startsWith(PREFIX)) toRemove.push(k);
    }
    for (const k of toRemove) sessionStorage.removeItem(k);
  } catch {
    // ignore
  }
}
