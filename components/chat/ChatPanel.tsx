"use client";
import { useEffect, useRef } from "react";
import { MessageCircle, X, Maximize2, Minimize2, Square } from "lucide-react";
import { signInAction } from "@/lib/actions";
import { useChatStore } from "@/store/chatStore";
import { useChatUIStore } from "@/store/chatUIStore";
import { useAuthSessionStore } from "@/store/authSessionStore";
import { useChatStream } from "@/lib/sseClient/useChatStream";
import { ConversationList } from "./ConversationList";
import { MessageList } from "./MessageList";
import { ChatInput } from "./ChatInput";
import { STATE_LABEL } from "@/lib/chat/stateMachine";
import { loadChatDraft, saveChatDraft } from "@/lib/chat/chatDraftStorage";

/** 与 SignInButton 一致：通过 Server Action 调用 lib/auth 导出的 signIn，避免客户端另起一套 */
function AuthRequiredCard() {
  return (
    <div
      className="flex flex-col items-center justify-center flex-1 min-h-0 px-6 py-8 text-center
                 bg-primary-800/50 border border-primary-700 rounded-xl mx-3 mb-2"
    >
      <h2 className="text-lg font-semibold text-primary-50 mb-2">需要登录</h2>
      <p className="text-sm text-primary-300 mb-6 max-w-[280px]">
        使用 AI 助手前请先登录账号，登录后即可正常对话。
      </p>
      <form action={signInAction}>
        <button
          type="submit"
          className="px-5 py-2.5 rounded-xl bg-accent-500 text-primary-900 font-medium text-sm
                     hover:bg-accent-600 transition-colors shadow-lg w-full"
        >
          使用 GitHub 登录
        </button>
      </form>
    </div>
  );
}

export function ChatPanel() {
  const auth = useAuthSessionStore((s) => s.auth);

  const {
    panelOpen,
    panelFullscreen,
    togglePanelOpen,
    togglePanelFullscreen,
    setInputText,
    inputText,
    authBlocked,
    setAuthBlocked,
    streamReconnecting,
  } = useChatUIStore();

  const draftPrevIdRef = useRef<string | null>(null);

  const { chatState, activeId, createConversation, activeMessages, _persistenceHydrated } =
    useChatStore();

  const isResponding = chatState !== "idle";

  const { sendMessage, stopMessage } = useChatStream();

  const sessionLoading = auth.status === "loading";
  const isLoggedIn = auth.status === "authenticated";
  const showAuthPrompt =
    !sessionLoading && (auth.status === "unauthenticated" || authBlocked);
  const inputLocked = sessionLoading || showAuthPrompt;

  useEffect(() => {
    if (auth.status === "authenticated" && authBlocked) {
      setAuthBlocked(false);
    }
  }, [auth.status, authBlocked, setAuthBlocked]);

  useEffect(() => {
    if (!_persistenceHydrated) return;
    if (panelOpen && isLoggedIn && !activeId) createConversation();
  }, [_persistenceHydrated, panelOpen, isLoggedIn, activeId, createConversation]);

  useEffect(() => {
    if (!activeId) return;
    const prev = draftPrevIdRef.current;
    if (prev && prev !== activeId) {
      saveChatDraft(prev, useChatUIStore.getState().inputText);
    }
    draftPrevIdRef.current = activeId;
    setInputText(loadChatDraft(activeId));
  }, [activeId, setInputText]);

  useEffect(() => {
    if (!activeId) return;
    const t = window.setTimeout(() => {
      saveChatDraft(activeId, inputText);
    }, 300);
    return () => window.clearTimeout(t);
  }, [activeId, inputText]);

  const handleSend = (text: string) => {
    if (inputLocked) return;
    if (!text.trim()) return;
    sendMessage(text);
    setInputText("");
    if (activeId) saveChatDraft(activeId, "");
  };

  const handleStop = () => {
    stopMessage();
  };

  if (!panelOpen) {
    return (
      <button
        onClick={togglePanelOpen}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 bg-accent-500 text-primary-900
                   rounded-full shadow-xl flex items-center justify-center
                   hover:bg-accent-600 hover:scale-105 transition-all"
      >
        <MessageCircle size={24} />
      </button>
    );
  }

  const panelCls = panelFullscreen
    ? "fixed inset-0 z-50 rounded-none"
    : "fixed bottom-6 right-6 z-50 w-[420px] h-[620px] rounded-2xl shadow-2xl";

  return (
    <div className={`${panelCls} flex bg-primary-900 border border-primary-700 overflow-hidden`}>
      {panelFullscreen && (
        <div className="w-52 shrink-0 border-r border-primary-700">
          <ConversationList />
        </div>
      )}

      <div className="flex flex-col flex-1 min-w-0 min-h-0">
        <div className="flex items-center justify-between px-4 py-3 border-b border-primary-700 shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-primary-100">AI 助手</span>
            {chatState !== "idle" && (
              <span className="text-xs text-accent-400 animate-pulse">
                · {STATE_LABEL[chatState]}
              </span>
            )}
          </div>
          <div className="flex items-center gap-0.5">
            {chatState !== "idle" && (
              <button
                onClick={handleStop}
                title="停止生成"
                className="p-1.5 text-red-400 hover:text-red-300 transition-colors rounded"
              >
                <Square size={14} />
              </button>
            )}
            <button
              onClick={togglePanelFullscreen}
              className="p-1.5 text-primary-400 hover:text-primary-100 transition-colors rounded"
            >
              {panelFullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
            </button>
            <button
              onClick={togglePanelOpen}
              className="p-1.5 text-primary-400 hover:text-primary-100 transition-colors rounded"
            >
              <X size={15} />
            </button>
          </div>
        </div>

        {auth.status === "authenticated" && auth.isStale ? (
          <div className="shrink-0 px-4 py-1.5 text-[11px] text-amber-400/95 bg-primary-800/80 border-b border-primary-700">
            网络不稳定，正在尝试同步登录状态…
          </div>
        ) : null}

        {sessionLoading ? (
          <div className="flex-1 flex items-center justify-center px-4">
            <p className="text-sm text-primary-400">正在检查登录状态…</p>
          </div>
        ) : showAuthPrompt ? (
          <AuthRequiredCard />
        ) : (
          <MessageList
            messages={activeMessages()}
            chatState={chatState}
            streamReconnecting={streamReconnecting}
          />
        )}

        {!sessionLoading && !showAuthPrompt && (
          <ChatInput
            onSend={handleSend}
            isResponding={isResponding}
            onStop={stopMessage}
            disabled={inputLocked}
          />
        )}
      </div>
    </div>
  );
}
