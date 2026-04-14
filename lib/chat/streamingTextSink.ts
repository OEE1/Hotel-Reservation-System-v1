/**
 * 将 SSE 的 delta / thinking 文本在单帧或 maxDelayMs 窗口内合并再写入 store，
 * 减轻每 token 触发 Zustand + Immer 的开销。仅用于客户端。
 */

export type StreamingTextSinkOptions = {
  maxDelayMs: number;
  onFlushDelta: (chunk: string) => void;
  onFlushThinking: (chunk: string) => void;
};

export type StreamingTextSink = {
  pushDelta: (chunk: string) => void;
  pushThinking: (chunk: string) => void;
  flushAll: () => void;
  clear: () => void;
};

const raf =
  typeof requestAnimationFrame === "function"
    ? requestAnimationFrame.bind(globalThis)
    : null;
const caf =
  typeof cancelAnimationFrame === "function"
    ? cancelAnimationFrame.bind(globalThis)
    : null;

export function createStreamingTextSink(
  options: StreamingTextSinkOptions
): StreamingTextSink {
  const { maxDelayMs, onFlushDelta, onFlushThinking } = options;

  let deltaBuf = "";
  let thinkingBuf = "";
  let rafId: number | null = null;
  let delayTimer: ReturnType<typeof setTimeout> | null = null;

  function clearTimers() {
    if (rafId !== null && caf) {
      caf(rafId);
      rafId = null;
    }
    if (delayTimer !== null) {
      clearTimeout(delayTimer);
      delayTimer = null;
    }
  }

  function flushDeltaLocked() {
    if (deltaBuf === "") return;
    const chunk = deltaBuf;
    deltaBuf = "";
    onFlushDelta(chunk);
  }

  function flushThinkingLocked() {
    if (thinkingBuf === "") return;
    const chunk = thinkingBuf;
    thinkingBuf = "";
    onFlushThinking(chunk);
  }

  function tick() {
    clearTimers();
    flushDeltaLocked();
    flushThinkingLocked();
  }

  function schedule() {
    if (deltaBuf === "" && thinkingBuf === "") return;

    if (!raf) {
      flushDeltaLocked();
      flushThinkingLocked();
      return;
    }

    if (rafId === null) {
      rafId = raf(() => {
        rafId = null;
        tick();
      });
    }
    if (delayTimer === null) {
      delayTimer = setTimeout(() => {
        delayTimer = null;
        tick();
      }, maxDelayMs);
    }
  }

  return {
    pushDelta(chunk: string) {
      if (!chunk) return;
      deltaBuf += chunk;
      schedule();
    },
    pushThinking(chunk: string) {
      if (!chunk) return;
      thinkingBuf += chunk;
      schedule();
    },
    flushAll() {
      clearTimers();
      flushDeltaLocked();
      flushThinkingLocked();
    },
    clear() {
      clearTimers();
      deltaBuf = "";
      thinkingBuf = "";
    },
  };
}

/** 与方案文档一致的默认兜底间隔（ms），后台标签页 rAF 降频时仍推进进度 */
export const DEFAULT_STREAMING_TEXT_MAX_DELAY_MS = 80;
