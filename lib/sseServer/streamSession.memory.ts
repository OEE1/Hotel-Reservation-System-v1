/**
 * M7：进程内 StreamSessionStore；延迟清理与 5A 丢头策略。
 */
import { chatLog } from "@/lib/observability/chatLog";
import type {
  BufferedEvent,
  StreamSession,
  StreamSessionStore,
} from "@/lib/sseServer/streamSessionStore";

const CLEANUP_MS = 10 * 60 * 1000;
const utf8Encoder = new TextEncoder();

function utf8ByteLength(s: string): number {
  return utf8Encoder.encode(s).length;
}

function sumEventsBytes(events: BufferedEvent[]): number {
  let t = 0;
  for (const e of events) t += utf8ByteLength(e.sse);
  return t;
}

export class MemoryStreamSessionStore implements StreamSessionStore {
  private readonly sessions = new Map<string, StreamSession>();

  async create(guestId: string): Promise<StreamSession> {
    const streamId = crypto.randomUUID();
    const session: StreamSession = {
      streamId,
      guestId,
      seq: 0,
      events: [],
      status: "running",
    };
    this.sessions.set(streamId, session);
    return session;
  }

  async get(streamId: string): Promise<StreamSession | null> {
    return this.sessions.get(streamId) ?? null;
  }

  async appendEvent(
    streamId: string,
    ev: BufferedEvent,
    opts: { maxEvents: number; maxBytes: number },
  ): Promise<{ dropped: number }> {
    const session = this.sessions.get(streamId);
    if (!session) {
      throw new Error(`StreamSession not found: ${streamId}`);
    }
    const evBytes = utf8ByteLength(ev.sse);
    let dropped = 0;

    while (true) {
      const nextLen = session.events.length + 1;
      const nextBytes = sumEventsBytes(session.events) + evBytes;
      if (nextLen <= opts.maxEvents && nextBytes <= opts.maxBytes) break;
      if (session.events.length === 0) break;
      session.events.shift();
      dropped++;
    }

    session.events.push(ev);
    session.seq = ev.seq;

    if (dropped > 0) {
      chatLog("warn", "buffer_trimmed", {
        streamId,
        dropped,
        reason: "buffer_max",
        contentLength: evBytes,
      });
    }

    return { dropped };
  }

  async markDone(streamId: string): Promise<void> {
    const s = this.sessions.get(streamId);
    if (!s) return;
    s.status = "done";
    this.scheduleDelete(streamId);
  }

  async markError(streamId: string): Promise<void> {
    const s = this.sessions.get(streamId);
    if (!s) return;
    s.status = "error";
    this.scheduleDelete(streamId);
  }

  private scheduleDelete(streamId: string): void {
    setTimeout(() => this.sessions.delete(streamId), CLEANUP_MS);
  }
}
