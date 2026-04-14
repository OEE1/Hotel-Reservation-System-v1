"use client";

import { useEffect } from "react";
import { useChatStore } from "@/store/chatStore";
import { loadSnapshot, saveSnapshot } from "@/lib/chat/chatPersistence";

const DEBOUNCE_MS = 400;

/**
 * 挂载时从 IndexedDB 恢复 chatStore；订阅变更并防抖写回；beforeunload 尽力同步保存。
 */
export function ChatPersistenceProvider({ children }: { children: React.ReactNode }) {
  const hydrated = useChatStore((s) => s._persistenceHydrated);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const snap = await loadSnapshot();
        if (cancelled) return;
        if (snap) {
          useChatStore.getState().hydrateFromPersistence(snap);
        }
      } catch (e) {
        console.warn("[chatPersistence] hydrate failed", e);
      } finally {
        if (!cancelled) useChatStore.getState().setPersistenceHydrated(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return;

    let timer: ReturnType<typeof setTimeout>;
    const scheduleSave = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const st = useChatStore.getState();
        void saveSnapshot({
          conversations: st.conversations,
          activeId: st.activeId,
          chatState: st.chatState,
        });
      }, DEBOUNCE_MS);
    };

    const unsub = useChatStore.subscribe(scheduleSave);

    const flush = () => {
      clearTimeout(timer);
      const st = useChatStore.getState();
      void saveSnapshot({
        conversations: st.conversations,
        activeId: st.activeId,
        chatState: st.chatState,
      });
    };

    window.addEventListener("beforeunload", flush);
    return () => {
      unsub();
      clearTimeout(timer);
      window.removeEventListener("beforeunload", flush);
      flush();
    };
  }, [hydrated]);

  return <>{children}</>;
}
