export interface SSEEvent {

  type: "thinking" | "tool_call" | "delta" | "done" | "error";
  data: unknown;
  id?: string;
}


// types/sse.ts
export interface SSEClientOptions {
  signal?: AbortSignal;                   // 外部 AbortController.signal
  onEvent: (event: SSEEvent) => void;
  onDone?: () => void;
  onError?: (err: Error) => void;
  /** 从发起请求到收到响应 body 首字节的最长等待（毫秒），默认 10000 */
  firstByteTimeoutMs?: number;
  /** 两次 chunk 之间的最长间隔（毫秒），默认 30000 */
  idleTimeoutMs?: number;
}