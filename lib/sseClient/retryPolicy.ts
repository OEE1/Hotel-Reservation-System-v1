/**
 * 判断错误是否属于典型的网络错误（断网、DNS 失败、CORS 等）。
 * 这类错误与认证无关，通常可以重试。
 */
export function isLikelyNetworkError(err: unknown): boolean {
  // 如果错误是 TypeError（fetch 网络错误通常抛出此类型），直接判定为网络错误
  if (err instanceof TypeError) return true;
  // 如果不是 Error 实例，无法判断，返回 false
  if (!(err instanceof Error)) return false;
  // 获取错误消息并转为小写，方便匹配
  const msg = err.message.toLowerCase();
  // 匹配常见的网络错误消息特征
  if (
    msg.includes("failed to fetch") ||      // fetch 失败
    msg.includes("networkerror") ||         // NetworkError
    msg.includes("load failed") ||          // 加载失败
    msg.includes("network request failed")  // 网络请求失败
  ) {
    return true;
  }
  // 如果错误名称为 "NetworkError"，也视为网络错误
  return err.name === "NetworkError";
}

/**
 * 判断错误是否可自动重试（即通过重试可能恢复的错误）。
 * 可重试的情况包括：网络错误、超时、5xx 服务端错误、429 限流。
 * 不可重试的情况包括：401/403（认证/权限问题）以及用户主动取消（AbortError）。
 */
export function isRetryableChatError(err: unknown): boolean {
  // 如果是 DOMException 且名称为 AbortError，表示用户主动取消了请求，不应重试
  if (err instanceof DOMException && err.name === "AbortError") return false;
  // 如果不是 Error 实例，无法判断，返回 false（默认不可重试）
  if (!(err instanceof Error)) return false;
  // 如果错误消息明确为 UNAUTHORIZED 或 FORBIDDEN，不重试（认证/权限错误）
  if (err.message === "UNAUTHORIZED" || err.message === "FORBIDDEN") return false;
  // 尝试获取错误对象上可能附加的 HTTP 状态码
  const status = (err as Error & { statusCode?: number }).statusCode;
  // 状态码 401 或 403 不重试
  if (status === 401 || status === 403) return false;
  // 状态码 429（Too Many Requests）可重试（通常需要等待后重试）
  if (status === 429) return true;
  // 状态码 >= 500 的服务端错误可重试
  if (typeof status === "number" && status >= 500) return true;
  // 超时错误（如 fetch 超时或自定义超时）可重试
  if (err.name === "TimeoutError") return true;
  // 首字节超时或空闲超时的自定义消息，可重试
  if (err.message === "First byte timeout" || err.message === "Idle timeout") return true;
  // SSE 流未完成错误，可重试（断点续传）
  if (err.name === "SSEIncompleteError" || err.message === "Stream ended without done event")
    return true;
  // 如果是 TypeError（通常为网络问题），可重试
  if (err instanceof TypeError) return true;
  // 其他情况默认不可重试
  return false;
}

// 最大重试轮次，包括初次尝试，共 5 次（0,1,2,3,4）
export const MAX_RETRY_ROUNDS = 5;
// 指数退避的初始延迟（毫秒）
export const RETRY_BACKOFF_INITIAL_MS = 1000;
// 指数退避的最大延迟（毫秒），避免延迟过长
export const RETRY_BACKOFF_MAX_MS = 32_000;

/**
 * 计算第 roundIndex 次重试的等待时间（指数退避）。
 * @param roundIndex 重试轮次索引，从 1 开始（第一次重试对应 roundIndex=1）
 * @returns 延迟毫秒数，不超过最大限制
 */
export function retryDelayMs(roundIndex: number): number {
  // 延迟 = 初始延迟 * 2^(roundIndex-1)，然后与最大值取小
  return Math.min(RETRY_BACKOFF_INITIAL_MS * 2 ** (roundIndex - 1), RETRY_BACKOFF_MAX_MS);
}