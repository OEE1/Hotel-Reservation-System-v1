// 从 Next.js 服务器端导入 NextRequest 和 NextResponse 类型
import { NextRequest, NextResponse } from "next/server";
// 导入 NextAuth 的认证函数，用于验证用户登录状态
import { auth } from "@/lib/auth";
// 导入处理聊天流的核心函数，负责生成 SSE 事件
import { handleChatStream } from "@/lib/sseServer/chatHandler";
// 导入聊天请求体的类型定义
import type { ChatRequestBody } from "@/types/chat";
// 导入格式化 SSE 消息的工具函数，将事件转换为 "event: xxx\ndata: ...\n\n" 格式
import { formatSSE } from "@/lib/sseServer/formatSSE";
// 导入断点续传相关的函数：解析事件ID、回放并跟随
import { parseEventId, replayAndFollow } from "@/lib/sseServer/streamSession";
import { getStreamSessionStore } from "@/lib/sseServer/streamSessionStore";
import {
  assertChatRateLimit,
  ChatRateLimitError,
  ChatRateLimitRedisError,
} from "@/lib/chat/rateLimit";
import { applyBudgetOrThrow, ChatBudgetError } from "@/lib/chat/budget";
import { isTokenizerEnabled } from "@/lib/chat/limits";
import { validateChatRequestBody, ChatValidationError } from "@/lib/chat/validateRequest";

// 定义 SSE 响应的 HTTP 头
const sseHeaders: HeadersInit = {
  "Content-Type": "text/event-stream; charset=utf-8", // 指定 SSE MIME 类型
  "Cache-Control": "no-cache, no-transform", // 禁止缓存，防止代理缓冲
  Connection: "keep-alive", // 保持连接持久
  "X-Accel-Buffering": "no", // 禁用 Nginx 缓冲（如果使用 Nginx）
};

function applyBudgetIfMessagesPresent(body: ChatRequestBody): ChatRequestBody {
  if (!body.messages?.length) return body;
  const mode = isTokenizerEnabled() ? "tokens" : "chars";
  const { messages } = applyBudgetOrThrow(body.messages, { mode });
  return { ...body, messages };
}

// 导出 POST 处理函数，响应 /api/chat 路由
export async function POST(req: NextRequest) {
  // 1. 认证：通过 NextAuth 获取当前会话，验证用户是否已登录
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const guestId = (session.user as { guestId?: string }).guestId;
  if (!guestId) {
    return NextResponse.json({ error: "Guest ID not found" }, { status: 401 });
  }

  // M5：限流（先于 body 解析；resume 与新聊共用配额）
  try {
    await assertChatRateLimit(req, guestId);
  } catch (err) {
    if (err instanceof ChatRateLimitError) {
      const retrySec = Math.max(1, Math.ceil(err.retryAfterMs / 1000));
      return NextResponse.json(
        { error: "Too many requests", code: err.code },
        {
          status: 429,
          headers: { "Retry-After": String(retrySec) },
        },
      );
    }
    if (err instanceof ChatRateLimitRedisError) {
      return NextResponse.json(
        { error: "Service Unavailable", code: "REDIS_UNAVAILABLE" },
        { status: 503 },
      );
    }
    throw err;
  }

  const body = (await req.json()) as ChatRequestBody;

  // M10：M3 / M4（续传分支允许无 messages；新聊必填）
  try {
    if (body.resumeFromEventId) {
      validateChatRequestBody(body, "resume");
    } else {
      validateChatRequestBody(body, "chat");
    }
  } catch (err) {
    if (err instanceof ChatValidationError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: 400 },
      );
    }
    throw err;
  }

  let budgetedBody = body;
  try {
    budgetedBody = applyBudgetIfMessagesPresent(body);
  } catch (err) {
    if (err instanceof ChatBudgetError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: 400 },
      );
    }
    throw err;
  }

  const store = getStreamSessionStore();

  // 断点续传分支
  if (budgetedBody.resumeFromEventId) {
    const parsed = parseEventId(budgetedBody.resumeFromEventId);
    if (!parsed) {
      return NextResponse.json({ error: "Invalid resume id" }, { status: 400 });
    }

    const streamSession = await store.get(parsed.streamId);
    if (!streamSession) {
      return NextResponse.json({ error: "Session expired" }, { status: 404 });
    }
    if (streamSession.guestId !== guestId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();

    (async () => {
      try {
        await replayAndFollow(
          store,
          parsed.streamId,
          parsed.seq,
          writer,
          encoder
        );
      } catch (err) {
        console.error("[chat/route] resume stream error:", err);
        const message = err instanceof Error ? err.message : "Resume failed";
        await writer.write(encoder.encode(formatSSE("error", { message }))).catch(() => {});
      } finally {
        await writer.close().catch(() => {});
      }
    })();

    return new Response(readable, { headers: sseHeaders });
  }

  // 新对话（非续传）
  if (!budgetedBody.messages?.length) {
    return NextResponse.json({ error: "messages is required" }, { status: 400 });
  }

  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  (async () => {
    try {
      await handleChatStream(
        budgetedBody.messages as never,
        writer,
        encoder,
        guestId,
        store
      );
    } catch (err) {
      console.error("[chat/route] stream error:", err);
      const message = err instanceof Error ? err.message : "Internal server error";
      await writer.write(encoder.encode(formatSSE("error", { message }))).catch(() => {});
    } finally {
      await writer.close().catch(() => {});
    }
  })();

  return new Response(readable, { headers: sseHeaders });
}
