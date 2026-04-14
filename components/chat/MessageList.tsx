"use client";
import { useRef, useEffect } from "react";
import { MessageBubble } from "./MessageBubble";
import { ThinkingIndicator } from "./ThinkingIndicator";
import { MessageSkeleton } from "./Skeleton";
import { ChatState } from "@/lib/chat/stateMachine";
import { MessageCircle } from "lucide-react";
import type { Message } from "@/types/chat";
interface Props {
  messages: Message[];
  chatState: ChatState;
  initialLoading?: boolean;
  /** SSE 断线自动重连等待中，在最后一条助手气泡显示提示 */
  streamReconnecting?: boolean;
}

export function MessageList({
  messages,
  chatState,
  initialLoading,
  streamReconnecting = false,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const userScrolledUp = useRef(false);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    userScrolledUp.current = el.scrollHeight - el.scrollTop - el.clientHeight > 80;
  };

  // 自动滚动到底部
  useEffect(() => {
    if (!userScrolledUp.current) {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }
  }, [messages, chatState]);

  // 空状态：仅当空闲且无消息且非初始加载时显示
  const showEmptyState = !initialLoading && messages.length === 0 && chatState === "idle";

  // 等待响应时显示三点动画（waiting 状态，且还没有任何消息内容）
  const showWaitingIndicator = chatState === "waiting" && messages.filter(m => m.role === "assistant").length === 0;

  // 是否正在响应（用于底部按钮）
  const isResponding = chatState !== "idle";

  return (
    <div className="relative flex-1 min-h-0">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="@container/msglist chat-message-scroll h-full px-4 py-4 flex flex-col gap-4"
      >
        {/* 初始加载骨架屏 */}
        {initialLoading && (
          <>
            <MessageSkeleton />
            <MessageSkeleton />
            <MessageSkeleton />
          </>
        )}

        {/* 空状态 */}
        {showEmptyState && (
          <div className="flex flex-col items-center justify-center h-full text-primary-500 select-none">
            <MessageCircle size={36} className="mb-3 opacity-20" />
            <p className="text-sm">有什么可以帮助你？</p>
          </div>
        )}

        {/* 消息列表 */}
        {messages.map((msg, i) => {
          const isLastAssistant = msg.role === "assistant" && i === messages.length - 1;
          const isStreaming = isLastAssistant && chatState === "answering";
          return (
            <MessageBubble
              key={msg.id}
              message={msg}
              isStreaming={isStreaming}
              reconnectHint={isLastAssistant && streamReconnecting}
            />
          );
        })}

        {/* 等待指示器（第一个响应前） */}
        {showWaitingIndicator && <ThinkingIndicator />}

      </div>

      {/* 用户上滚后的“回到底部”提示 */}
      {isResponding && (
        <button
          onClick={() => {
            userScrolledUp.current = false;
            const el = scrollRef.current;
            if (el) el.scrollTop = el.scrollHeight;
          }}
          className="absolute bottom-3 left-1/2 -translate-x-1/2
                     px-3 py-1.5 text-xs bg-primary-700 text-primary-200
                     rounded-full border border-primary-600 hover:bg-primary-600
                     transition-all shadow-lg"
        >
          ↓ 正在生成
        </button>
      )}
    </div>
  );
}