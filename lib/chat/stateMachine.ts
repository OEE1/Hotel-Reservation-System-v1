// lib/chat/stateMachine.ts
// 修改后
export type ChatState = "idle" | "waiting" | "thinking" | "tool_calling" | "answering";

export type ChatAction =
  | { type: "START" }
  | { type: "THINKING" }   // ← 新增，对应 SSE "thinking" 事件
  | { type: "TOOL_CALL" }
  | { type: "DELTA" }
  | { type: "DONE" }
  | { type: "ERROR" };

// 修改后
export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (state) {
    case "idle":
      if (action.type === "START") return "waiting";     // ← "thinking" → "waiting"
      break;
    case "waiting":                                       // ← 原 "thinking" case 改名
      if (action.type === "THINKING") return "thinking"; // ← 收到推理流，进入 thinking
      if (action.type === "TOOL_CALL") return "tool_calling";
      if (action.type === "DELTA") return "answering";
      if (action.type === "DONE" || action.type === "ERROR") return "idle";
      break;
    case "thinking":
      if (action.type === "THINKING") return "thinking"; // 继续思考，保持
      if (action.type === "TOOL_CALL") return "tool_calling";
      if (action.type === "DELTA") return "answering";
      if (action.type === "DONE" || action.type === "ERROR") return "idle";
      break;
    case "tool_calling":
      if (action.type === "THINKING") return "thinking"; // ← 工具调用后可能再次推理
      if (action.type === "DELTA") return "answering";
      if (action.type === "DONE" || action.type === "ERROR") return "idle";
      break;
    case "answering":
      if (action.type === "TOOL_CALL") return "tool_calling";
      if (action.type === "DONE" || action.type === "ERROR") return "idle";
      break;
  }
  return state;
}
export const STATE_LABEL: Record<ChatState, string> = {
  idle: "空闲",
  waiting: "等待响应",
  thinking: "正在思考…",
  tool_calling: "调用工具",
  answering: "正在回答",
};