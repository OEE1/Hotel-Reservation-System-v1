/**
 * M6：StreamSessionStore 契约与持久化形状（内存 / Redis 共用）。
 */
import { getChatSessionTtlSec, getSessionStoreKind } from "@/lib/chat/limits";
import { chatLog } from "@/lib/observability/chatLog";
import { getSessionRedisForStore } from "@/lib/redis/sessionRedisFactory";
import { MemoryStreamSessionStore } from "@/lib/sseServer/streamSession.memory";
import { RedisStreamSessionStore } from "@/lib/sseServer/streamSession.redis";

export interface BufferedEvent {
  seq: number;
  id: string;
  sse: string;
}

export interface StreamSession {
  streamId: string;
  guestId: string;
  seq: number;
  events: BufferedEvent[];
  status: "running" | "done" | "error";
}

export interface StreamSessionStore {
  create(guestId: string): Promise<StreamSession>;
  get(streamId: string): Promise<StreamSession | null>;
  appendEvent(
    streamId: string,
    ev: BufferedEvent,
    opts: { maxEvents: number; maxBytes: number },
  ): Promise<{ dropped: number }>;
  markDone(streamId: string): Promise<void>;
  markError(streamId: string): Promise<void>;
}

let singleton: StreamSessionStore | null = null;

/** 测试或切换 env 时重置单例 */
export function resetStreamSessionStoreSingleton(): void {
  singleton = null;
}

/** M7 内存默认；`CHAT_SESSION_STORE=redis` 且 Redis 可用时用 M8 */
export function getStreamSessionStore(): StreamSessionStore {
  if (!singleton) {
    if (getSessionStoreKind() === "redis") {
      const r = getSessionRedisForStore();
      if (r) {
        singleton = new RedisStreamSessionStore(r, getChatSessionTtlSec());
      } else {
        chatLog("warn", "redis_unavail", {
          reason: "session_store_redis_missing",
        });
        singleton = new MemoryStreamSessionStore();
      }
    } else {
      singleton = new MemoryStreamSessionStore();
    }
  }
  return singleton;
}
