// 指定此文件为 Next.js 客户端组件，仅在浏览器端执行
"use client";

// 导入自定义的 API 请求封装函数
import { apiFetch } from "@/lib/http/apiFetch";
// 导入 SSE 客户端选项和事件类型
import { SSEClientOptions, SSEEvent } from "@/types/sse";
// 导入 SSE 事件解析器
import { parseSSEEvent } from "./parser";

/**
 * 发起 SSE 流式请求
 * @param url 请求 URL
 * @param body 请求体（JSON 对象）
 * @param options 配置项，包括信号、事件回调、超时等
 * @returns Promise<void>
 */
export async function fetchSSE(
  url: string,
  body: Record<string, unknown>,
  options: SSEClientOptions
): Promise<void> {
  // 解构配置项，提供默认超时值
  const {
    signal: userSignal,                // 外部传入的 AbortSignal，用于取消请求
    onEvent,                           // 每个 SSE 事件的处理回调
    onError,                           // 错误处理回调
    onDone,                            // 流正常结束的回调（仅在收到 done 事件时触发）
    firstByteTimeoutMs = 10_000,       // 首字节超时，默认 10 秒
    idleTimeoutMs = 30_000,            // 空闲超时（两次数据间无新数据），默认 30 秒
  } = options;

  // 创建内部 AbortController，用于超时控制
  const mainAbort = new AbortController();
  // 首字节超时定时器
  let firstByteTimer: ReturnType<typeof setTimeout> | null = null;
  // 空闲超时定时器
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  /** 记录中断原因，便于在 catch 中区分是用户取消还是超时 */
  const abortState = { kind: "none" as "none" | "user" | "firstbyte" | "idle" };

  // 清除所有定时器
  const clearTimers = () => {
    if (firstByteTimer) {
      clearTimeout(firstByteTimer);
      firstByteTimer = null;
    }
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  };

  // 用户主动取消的处理函数
  const onUserAbort = () => {
    abortState.kind = "user";          // 标记为用户取消
    clearTimers();                     // 清除定时器
    // 中止内部请求，并传递外部 signal 的 reason（如果有）
    mainAbort.abort(userSignal?.reason ?? new DOMException("Aborted", "AbortError"));
  };

  // 如果外部传入了 signal，则监听其 abort 事件
  if (userSignal) {
    if (userSignal.aborted) {
      // 如果外部 signal 已经处于中止状态，立即执行取消逻辑
      onUserAbort();
      return;
    }
    // 监听外部 signal 的 abort 事件，一旦触发就调用 onUserAbort
    userSignal.addEventListener("abort", onUserAbort, { once: true });
  }

  // 设置首字节超时：如果在指定时间内没有收到第一个数据块，则主动中止
  firstByteTimer = setTimeout(() => {
    firstByteTimer = null;             // 定时器已触发，清空引用
    abortState.kind = "firstbyte";     // 标记为首字节超时
    mainAbort.abort(new DOMException("First byte timeout", "TimeoutError"));
  }, firstByteTimeoutMs);

  // 重置空闲超时：每次收到数据后重置定时器
  const resetIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      idleTimer = null;
      abortState.kind = "idle";        // 标记为空闲超时
      mainAbort.abort(new DOMException("Idle timeout", "TimeoutError"));
    }, idleTimeoutMs);
  };

  try {
    // 发起 POST 请求，使用 apiFetch 封装，传递内部 AbortController 的 signal
    const res = await apiFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: mainAbort.signal,
    });

    // 收到响应后，清除首字节定时器（因为已经收到了响应头/首字节）
    if (firstByteTimer) {
      clearTimeout(firstByteTimer);
      firstByteTimer = null;
    }

    // 检查 HTTP 状态码
    if (!res.ok) {
      // 401 未授权，构造特定错误并附带状态码
      if (res.status === 401) {
        const err = new Error("UNAUTHORIZED");
        (err as Error & { statusCode?: number }).statusCode = 401;
        throw err;
      }
      // 403 禁止访问
      if (res.status === 403) {
        const err = new Error("FORBIDDEN");
        (err as Error & { statusCode?: number }).statusCode = 403;
        throw err;
      }
      // 其他 HTTP 错误
      const err = new Error(`HTTP ${res.status}: ${res.statusText}`);
      (err as Error & { statusCode?: number }).statusCode = res.status;
      throw err;
    }
    // 确保响应体存在（ReadableStream）
    if (!res.body) {
      throw new Error("Response has no readable stream");
    }

    // 收到有效响应，重置空闲定时器（开始接收流数据）
    resetIdle();

    // 获取 ReadableStream 的 reader
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";                    // 缓存未完全解析的数据

    // 循环读取流数据
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;                 // 流结束

      // 每收到一块数据，重置空闲超时
      resetIdle();

      // 将二进制数据解码为字符串，追加到缓冲区
      buffer += decoder.decode(value, { stream: true });

      // 按 "\n\n" 分割消息（SSE 标准消息分隔符）
      const parts = buffer.split("\n\n");
      // 最后一部分可能不完整，保留在 buffer 中
      buffer = parts.pop() ?? "";

      // 遍历每个完整的消息部分
      for (const part of parts) {
        const trimmed = part.trim();
        if (!trimmed) continue;

        // 解析消息为 SSEEvent 对象
        const event: SSEEvent = parseSSEEvent(trimmed);

        // 如果收到 done 事件，表示流正常结束
        if (event.type === "done") {
          onEvent(event);              // 先通知事件
          onDone?.();                 // 调用完成回调
          return;                     // 结束函数，不再继续读取
        }

        // 如果收到 error 事件，表示服务端主动报告错误
        if (event.type === "error") {
          onEvent(event);              // 通知事件
          onError?.(new Error(String(event.data))); // 调用错误回调
          return;                     // 结束
        }

        // 其他类型的事件（thinking, delta, tool_call 等），直接传递
        onEvent(event);
      }
    }

    // 循环正常退出（done 为 true）但未收到 event: done，说明流提前结束，应触发重试
    const incomplete = new Error("Stream ended without done event");
    incomplete.name = "SSEIncompleteError";
    onError?.(incomplete);
  } catch (err: unknown) {
    // 根据中断原因处理错误
    if (abortState.kind === "user") return;          // 用户主动取消，不触发错误回调
    if (abortState.kind === "firstbyte" || abortState.kind === "idle") {
      // 超时错误，构造 TimeoutError 并调用 onError
      const msg = abortState.kind === "firstbyte" ? "First byte timeout" : "Idle timeout";
      const e = new Error(msg);
      e.name = "TimeoutError";
      onError?.(e);
      return;
    }
    // 如果是 AbortError 且不是用户信号引起的，也当作超时处理
    if (err instanceof DOMException && err.name === "AbortError") {
      if (userSignal?.aborted) return;   // 用户已主动取消，忽略
      const e = new Error("Request aborted");
      e.name = "TimeoutError";
      onError?.(e);
      return;
    }
    // 其他错误，直接传递
    onError?.(err instanceof Error ? err : new Error(String(err)));
  } finally {
    // 清理：移除事件监听、清除定时器
    userSignal?.removeEventListener("abort", onUserAbort);
    clearTimers();
  }
}