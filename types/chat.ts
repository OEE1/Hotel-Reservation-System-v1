//types/chat.ts
export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
  status: "running" | "done" | "error";
  input?: Record<string, unknown>;
  output?: unknown;
  error?: string;
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  thinking?: string;
  toolCalls?: ToolCall[];
  /** 用户主动停止 SSE，该轮未正常 done；不参与下一轮 API 拼接，UI 可标「已停止」 */
  streamStopped?: boolean;
  createdAt: number;
}
export interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
}

// Used by `app/chat/page.tsx` test page to type SSE delta chunks.
export interface DeltaPayload {
  content?: string | null;
}

// Used when sending messages to the server for SSE streaming.
// (Matches DeepSeek/OpenAI `messages` schema at a minimal level.)
export type ChatMessage = {
  role: string;
  content: string;
};
export interface ChatRequestBody {
  /** 新对话必填；续传时可与 resumeFromEventId 同时带上最近一次完整 messages 供服务端校验扩展 */
  messages?: Message[];
  /** 断点续传：值为上次收到的 SSE `id`（形如 streamId:seq） */
  resumeFromEventId?: string;
}