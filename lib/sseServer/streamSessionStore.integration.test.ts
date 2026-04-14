import { webcrypto } from "node:crypto";
import { describe, expect, it } from "vitest";

if (typeof globalThis.crypto === "undefined") {
  (globalThis as unknown as { crypto: Crypto }).crypto = webcrypto as Crypto;
}

import { getSessionRedisForStore, resetSessionRedisCache } from "@/lib/redis/sessionRedisFactory";
import { MemoryStreamSessionStore } from "@/lib/sseServer/streamSession.memory";
import { RedisStreamSessionStore } from "@/lib/sseServer/streamSession.redis";

describe("StreamSessionStore (M7/M8)", () => {
  it("memory: create + append + get", async () => {
    const store = new MemoryStreamSessionStore();
    const s = await store.create("guest-int");
    await store.appendEvent(
      s.streamId,
      { seq: 1, id: `${s.streamId}:1`, sse: "event:x\ndata:1\n\n" },
      { maxEvents: 10, maxBytes: 100_000 },
    );
    const g = await store.get(s.streamId);
    expect(g?.seq).toBe(1);
    expect(g?.events).toHaveLength(1);
  });

  it.skipIf(!process.env.REDIS_URL)("redis: create + append + get", async () => {
    resetSessionRedisCache();
    const r = getSessionRedisForStore();
    if (!r) throw new Error("expected Redis client when REDIS_URL is set");
    const store = new RedisStreamSessionStore(r, 600);
    const s = await store.create("guest-redis-int");
    await store.appendEvent(
      s.streamId,
      { seq: 1, id: `${s.streamId}:1`, sse: "e\n\n" },
      { maxEvents: 10, maxBytes: 100_000 },
    );
    const g = await store.get(s.streamId);
    expect(g?.seq).toBe(1);
  });
});
