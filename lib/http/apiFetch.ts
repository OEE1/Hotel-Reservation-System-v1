import { clearCachedSession } from "@/lib/auth/sessionStorageAuth";
import { clearAllChatDrafts } from "@/lib/chat/chatDraftStorage";
import { clearChatPersistence } from "@/lib/chat/chatPersistence";
import { resetAuthToUnauthenticated } from "@/store/authSessionStore";
import { useChatStore } from "@/store/chatStore";

function isSameOriginBusinessApi(url: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    const path =
      url.startsWith("http") ? new URL(url, window.location.origin).pathname : url;
    return path.startsWith("/api/") && !path.startsWith("/api/auth/");
  } catch {
    return false;
  }
}

async function handleApiUnauthorized(): Promise<void> {
  await clearChatPersistence();
  clearAllChatDrafts();
  useChatStore.getState().clearAllConversations();
  clearCachedSession();
  resetAuthToUnauthenticated();
  const { signOut } = await import("next-auth/react");
  await signOut({ callbackUrl: "/login" });
}

/**
 * 同源业务 API 的 fetch；401 时清本地会话并 signOut 跳转 /login。
 */
export async function apiFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const res = await fetch(input, init);
  const url =
    typeof input === "string"
      ? input
      : input instanceof Request
        ? input.url
        : String(input);
  if (res.status === 401 && isSameOriginBusinessApi(url)) {
    await handleApiUnauthorized();
  }
  return res;
}
