import { SSEEvent } from "@/types/sse";

/**
 * 解析单个 SSE 事件文本块（以 \n 一行分隔的一段）
 * 支持多行 data 拼接
 */
export function parseSSEEvent(raw: string): SSEEvent {
  const event: SSEEvent = { type: "delta", data: "" };
  const lines = raw.split("\n");

  let dataLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith("event: ")) {
      event.type = line.slice(7).trim() as SSEEvent["type"];
    } else if (line.startsWith("data: ")) {
      dataLines.push(line.slice(6));
    } else if (line.startsWith("id: ")) {
      event.id = line.slice(4).trim();
    }
  }

  // 多行 data 拼接
  const joined = dataLines.join("\n");

  // 尝试 JSON 解析
  try {
    event.data = JSON.parse(joined);
  } catch {
    event.data = joined;
  }

  return event;
}