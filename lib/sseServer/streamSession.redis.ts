/**
 * M8：Redis 版 StreamSessionStore；键前缀 `stream:session:`，与 ratelimit:* 隔离。
 * appendEvent 使用 Lua + cjson 保证原子性（与 M7 内存语义一致）。
 */
import { chatLog } from "@/lib/observability/chatLog";
import { getChatSessionTtlSec } from "@/lib/chat/limits";
import type { SessionRedisHandle } from "@/lib/redis/sessionRedisFactory";
import type {
  BufferedEvent,
  StreamSession,
  StreamSessionStore,
} from "@/lib/sseServer/streamSessionStore";

const KEY_PREFIX = "stream:session:";

/** Lua：读会话 JSON → 5A 丢头 → 追加事件 → SET EX；返回 dropped（整数） */
const APPEND_EVENT_LUA = `
local key = KEYS[1]
local maxEvents = tonumber(ARGV[1])
local maxBytes = tonumber(ARGV[2])
local ttlSec = tonumber(ARGV[3])
local evJson = ARGV[4]

local raw = redis.call('GET', key)
if not raw then
  return redis.error_reply('NOT_FOUND')
end

local session = cjson.decode(raw)
local ev = cjson.decode(evJson)

local function sumBytes(events)
  local t = 0
  for i = 1, #events do
    t = t + string.len(events[i].sse)
  end
  return t
end

local evBytes = string.len(ev.sse)
local dropped = 0

while true do
  local nextLen = #session.events + 1
  local nextBytes = sumBytes(session.events) + evBytes
  if nextLen <= maxEvents and nextBytes <= maxBytes then
    break
  end
  if #session.events == 0 then
    break
  end
  table.remove(session.events, 1)
  dropped = dropped + 1
end

table.insert(session.events, ev)
session.seq = ev.seq

local newVal = cjson.encode(session)
redis.call('SET', key, newVal, 'EX', ttlSec)
return dropped
`;

function sessionKey(streamId: string): string {
  return `${KEY_PREFIX}${streamId}`;
}

function parseSession(raw: string): StreamSession {
  return JSON.parse(raw) as StreamSession;
}

async function redisGet(handle: SessionRedisHandle, key: string): Promise<string | null> {
  if (handle.kind === "ioredis") {
    const v = await handle.client.get(key);
    return v;
  }
  const v = await handle.client.get(key);
  return v === null ? null : String(v);
}

async function redisSetEx(
  handle: SessionRedisHandle,
  key: string,
  value: string,
  ttlSec: number,
): Promise<void> {
  if (handle.kind === "ioredis") {
    await handle.client.set(key, value, "EX", ttlSec);
    return;
  }
  await handle.client.set(key, value, { ex: ttlSec });
}

async function redisEval(
  handle: SessionRedisHandle,
  script: string,
  keys: string[],
  args: string[],
): Promise<unknown> {
  if (handle.kind === "ioredis") {
    return handle.client.eval(script, keys.length, ...keys, ...args);
  }
  return handle.client.eval(script, keys, args);
}

export class RedisStreamSessionStore implements StreamSessionStore {
  constructor(
    private readonly redis: SessionRedisHandle,
    private readonly ttlSec: number = getChatSessionTtlSec(),
  ) {}

  async create(guestId: string): Promise<StreamSession> {
    const streamId = crypto.randomUUID();
    const session: StreamSession = {
      streamId,
      guestId,
      seq: 0,
      events: [],
      status: "running",
    };
    const key = sessionKey(streamId);
    await redisSetEx(this.redis, key, JSON.stringify(session), this.ttlSec);
    return session;
  }

  async get(streamId: string): Promise<StreamSession | null> {
    const raw = await redisGet(this.redis, sessionKey(streamId));
    if (!raw) return null;
    try {
      return parseSession(raw);
    } catch {
      return null;
    }
  }

  async appendEvent(
    streamId: string,
    ev: BufferedEvent,
    opts: { maxEvents: number; maxBytes: number },
  ): Promise<{ dropped: number }> {
    const key = sessionKey(streamId);
    const evJson = JSON.stringify(ev);
    try {
      const droppedRaw = await redisEval(this.redis, APPEND_EVENT_LUA, [key], [
        String(opts.maxEvents),
        String(opts.maxBytes),
        String(this.ttlSec),
        evJson,
      ]);
      const dropped =
        typeof droppedRaw === "number" ? droppedRaw : Number(droppedRaw);
      if (dropped > 0) {
        chatLog("warn", "buffer_trimmed", {
          streamId,
          dropped,
          reason: "buffer_max",
          contentLength: ev.sse.length,
        });
      }
      return { dropped };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("NOT_FOUND")) {
        throw new Error(`StreamSession not found: ${streamId}`);
      }
      throw e;
    }
  }

  async markDone(streamId: string): Promise<void> {
    await this.patchStatus(streamId, "done");
  }

  async markError(streamId: string): Promise<void> {
    await this.patchStatus(streamId, "error");
  }

  private async patchStatus(streamId: string, status: "done" | "error"): Promise<void> {
    const key = sessionKey(streamId);
    const raw = await redisGet(this.redis, key);
    if (!raw) return;
    let session: StreamSession;
    try {
      session = parseSession(raw);
    } catch {
      return;
    }
    session.status = status;
    await redisSetEx(this.redis, key, JSON.stringify(session), this.ttlSec);
  }
}
