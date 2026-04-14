import { getBufferLimits } from "@/lib/chat/limits";
import { formatSSE } from "@/lib/sseServer/formatSSE";
import {
  type StreamSession,
  type StreamSessionStore,
} from "@/lib/sseServer/streamSessionStore";
import type { SSEEvent } from "@/types/sse";

export type { BufferedEvent, StreamSession } from "@/lib/sseServer/streamSessionStore";

/** id 格式：`${streamId}:${seq}`（streamId 为 UUID，不含 `:`） */
export function parseEventId(resumeFromEventId: string): { streamId: string; seq: number } | null {
  const idx = resumeFromEventId.lastIndexOf(":");
  if (idx <= 0) return null;
  const streamId = resumeFromEventId.slice(0, idx);
  const seq = parseInt(resumeFromEventId.slice(idx + 1), 10);
  if (Number.isNaN(seq) || !streamId) return null;
  return { streamId, seq };
}

export async function createStreamSession(
  guestId: string,
  store: StreamSessionStore,
): Promise<StreamSession> {
  return store.create(guestId);
}

export async function markSessionDone(streamId: string, store: StreamSessionStore): Promise<void> {
  await store.markDone(streamId);
}

export async function markSessionError(streamId: string, store: StreamSessionStore): Promise<void> {
  await store.markError(streamId);
}

export type SSEWriter = (type: SSEEvent["type"], data: unknown) => Promise<void>;

export type CreateSSEWriterOptions = {
  store: StreamSessionStore;
  buffer: { maxEvents: number; maxBytes: number };
};

/**
 * 每条 SSE 经 store.appendEvent（5A）缓冲，并可选推送到当前 HTTP writer；
 * writer 写失败视为客户端断开，继续缓冲供续传。
 */
export function createSSEWriter(
  session: StreamSession,
  encoder: TextEncoder,
  writerRef: { current: WritableStreamDefaultWriter<Uint8Array> | null },
  options: CreateSSEWriterOptions
): SSEWriter {
  const { store, buffer } = options;
  return async function writeSSE(type: SSEEvent["type"], data: unknown) {
    session.seq += 1;
    const id = `${session.streamId}:${session.seq}`;
    const sse = formatSSE(type, data, id);
    await store.appendEvent(session.streamId, { seq: session.seq, id, sse }, buffer);
    const w = writerRef.current;
    if (w) {
      try {
        await w.write(encoder.encode(sse));
      } catch {
        writerRef.current = null;
      }
    }
  };
}

/** 使用 `getBufferLimits()` 与注入的 store（M10 深注入） */
export function createSSEWriterWithBufferLimits(
  session: StreamSession,
  encoder: TextEncoder,
  writerRef: { current: WritableStreamDefaultWriter<Uint8Array> | null },
  store: StreamSessionStore,
): SSEWriter {
  return createSSEWriter(session, encoder, writerRef, {
    store,
    buffer: getBufferLimits(),
  });
}

/**
 * 续传：从 store 读取最新会话，重放 seq > lastSeqExclusive 的事件；
 * 若流仍在进行则轮询直至结束。
 */
export async function replayAndFollow(
  store: StreamSessionStore,
  streamId: string,
  lastSeqExclusive: number,
  writer: WritableStreamDefaultWriter<Uint8Array>,
  encoder: TextEncoder,
  signal?: AbortSignal
): Promise<void> {
  let watermark = lastSeqExclusive;

  while (true) {
    if (signal?.aborted) return;

    const session = await store.get(streamId);
    if (!session) return;

    let advanced = false;
    for (const ev of session.events) {
      if (ev.seq > watermark) {
        await writer.write(encoder.encode(ev.sse));
        watermark = ev.seq;
        advanced = true;
      }
    }

    if (session.status !== "running") break;
    if (!advanced) await new Promise((r) => setTimeout(r, 50));
  }
}
