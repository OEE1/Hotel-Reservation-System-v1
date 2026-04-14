// Server-side shared types for SSE LLM stream consumption + tool execution.
// This is intentionally separate from `types/chat.ts` (client UI state types),
// because DeepSeek/OpenAI tool-calling messages include fields the UI doesn't store
// (e.g. `role: "tool"`, `tool_call_id`, `tool_calls`).

export interface ToolCallBuffer {
  id: string;
  name: string;
  arguments: string; // JSON string emitted by the model (may arrive in chunks)
}

export type ChatMessage =
  | { role: "user"; content: string }
  | {
      role: "assistant";
      // DeepSeek/OpenAI allow assistant.content to be null when it only emits tool calls.
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }>;
    }
  | {
      role: "tool";
      tool_call_id: string;
      content: string;
    };

export type Message = ChatMessage;

