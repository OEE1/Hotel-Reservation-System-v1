import { getChatLimits, type ChatErrorCode } from "@/lib/chat/limits";
import type { ChatRequestBody } from "@/types/chat";

export class ChatValidationError extends Error {
  readonly code: ChatErrorCode;

  constructor(code: ChatErrorCode, message?: string) {
    super(message ?? code);
    this.name = "ChatValidationError";
    this.code = code;
  }
}

function assertMessageShape(
  body: ChatRequestBody,
  limits: ReturnType<typeof getChatLimits>,
): void {
  const { messages } = body;
  if (!messages?.length) return;

  if (messages.length > limits.maxMessages) {
    throw new ChatValidationError("VALIDATION_TOO_MANY_MESSAGES");
  }

  for (const m of messages) {
    if (m.role !== "user" && m.role !== "assistant") {
      throw new ChatValidationError("VALIDATION_INVALID_ROLE");
    }
    const text = (m.content ?? "").trim();
    if (!text) {
      throw new ChatValidationError("VALIDATION_EMPTY_CONTENT");
    }
    // 码点长度，与 budget 一致
    const len = [...text].length;
    if (len > limits.maxMessageChars) {
      throw new ChatValidationError("VALIDATION_MESSAGE_TOO_LONG");
    }
  }
}

/**
 * @param mode `chat`：messages 必填且非空；`resume`：可仅续传；若带 messages 则同样做条数/长度校验
 */
export function validateChatRequestBody(
  body: ChatRequestBody,
  mode: "chat" | "resume",
): void {
  const limits = getChatLimits();

  if (mode === "chat") {
    if (!body.messages?.length) {
      throw new ChatValidationError(
        "VALIDATION_EMPTY_CONTENT",
        "messages is required",
      );
    }
    assertMessageShape(body, limits);
    return;
  }

  // resume：有 messages 时校验
  assertMessageShape(body, limits);
}
