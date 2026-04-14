/**
 * 单行 JSON 结构化日志（服务端）；禁止默认打印完整用户 content。
 */

export type ChatLogLevel = "info" | "warn" | "error";

/** 与聊天配额/裁剪相关的可观测事件名 */
export type ChatLogEventName =
  | "env_parse_failed"
  | "context_trimmed"
  | "context_rejected"
  | "buffer_trimmed"
  | "redis_unavail"
  | "rate_limit";

export type ChatLogFields = Record<string, unknown> & {
  event?: ChatLogEventName | string;
  timestamp?: string;
  guestId?: string;
  streamId?: string;
  reason?: string;
  code?: string;
  /** 正文长度，禁止默认记录全文 */
  contentLength?: number;
  /** 限流建议等待（毫秒），非正文 */
  retryAfterMs?: number;
};

/**
 * @param level 日志级别
 * @param event 事件名（写入 JSON 的 `event` 字段）
 * @param fields 附加字段；勿传入完整 message content
 */
export function chatLog(
  level: ChatLogLevel,
  event: ChatLogEventName | string,
  fields: ChatLogFields = {},
): void {
  const line = JSON.stringify({
    event,
    timestamp: new Date().toISOString(),
    ...fields,
  });
  if (level === "info") {
    console.info(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.error(line);
  }
}
