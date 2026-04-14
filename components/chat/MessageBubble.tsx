"use client";

import React from "react";
import { Bot, User } from "lucide-react";
import { Message } from "@/types/chat";
import { MessageRenderer } from "./MessageRenderer";
import { ThinkingPanel } from "./ThinkingPanel";
import { ToolCallCard } from "./ToolCallCard";

interface Props {
  message: Message;
  isStreaming?: boolean;
  /** 连接中断、正在自动重试 */
  reconnectHint?: boolean;
}

export function MessageBubble({
  message,
  isStreaming = false,
  reconnectHint = false,
}: Props) {
  const isUser = message.role === "user";
  const toolCalls = message.toolCalls ?? [];

  const bubbleRow = (
    <div className={`flex gap-3 ${isUser ? "flex-row-reverse" : "flex-row"}`}>
      <div
        className={[
          "shrink-0 w-8 h-8 rounded-full flex items-center justify-center",
          isUser ? "bg-accent-500 text-primary-900" : "bg-primary-700 text-accent-400",
        ].join(" ")}
      >
        {isUser ? <User size={14} /> : <Bot size={14} />}
      </div>

      <div className={`flex flex-col max-w-[82%] ${isUser ? "items-end" : "items-start"} min-w-0`}>
        {isUser ? (
          <>
            <div
              className={[
                "rounded-2xl px-4 py-3 text-sm max-w-full",
                "bg-accent-500 text-primary-900 rounded-tr-sm",
              ].join(" ")}
            >
              <p className="whitespace-pre-wrap break-words break-all">{message.content}</p>
            </div>
            <time className="text-[10px] text-primary-500 mt-1 px-1">
              {new Date(message.createdAt).toLocaleTimeString("zh-CN", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </time>
          </>
        ) : (
          <>
            <div className="flex flex-col w-fit max-w-full min-w-0 gap-1 @lg:gap-2">
              {message.thinking ? (
                <ThinkingPanel content={message.thinking} isStreaming={isStreaming} />
              ) : null}

              <div
                className={[
                  "w-full min-w-0 rounded-2xl px-4 py-3 text-sm",
                  "bg-primary-800 text-primary-100 rounded-tl-sm",
                ].join(" ")}
              >
                <React.Fragment>
                  <MessageRenderer content={message.content} streaming={isStreaming} />
                  {isStreaming && (
                    <span className="inline-block w-2 h-4 bg-accent-500 animate-pulse ml-0.5 align-middle" />
                  )}
                </React.Fragment>
              </div>
            </div>

            {reconnectHint ? (
              <p className="text-[10px] text-amber-400/90 mt-1 px-1">连接中断，正在重试…</p>
            ) : null}
            {message.streamStopped ? (
              <p className="text-[10px] text-primary-500 mt-1 px-1">已停止生成</p>
            ) : null}

            <time className="text-[10px] text-primary-500 mt-1 px-1">
              {new Date(message.createdAt).toLocaleTimeString("zh-CN", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </time>
          </>
        )}
      </div>
    </div>
  );

  if (isUser) {
    return bubbleRow;
  }

  return (
    <div className="flex flex-col gap-2 w-full min-w-0">
      {bubbleRow}
      {toolCalls.length > 0 ? (
        <div className="flex w-full min-w-0 gap-3">
          <div className="shrink-0 w-8" aria-hidden />
          <div className="flex min-w-0 w-full max-w-[min(82%,36rem)] flex-col gap-2">
            {toolCalls.map((tc) => (
              <ToolCallCard key={tc.id} tool={tc} />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}