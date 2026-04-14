/**
 * 聊天上限：默认常量 + 服务端 `process.env` 可选覆盖（策略 B）。
 * env 键名集中在此，避免散落魔法字符串。
 */
import { chatLog } from "@/lib/observability/chatLog";

/** 与文档 design-m1-m4 一致的 env 键名 */
export const CHAT_ENV_KEYS = {
  MAX_MESSAGES: "CHAT_MAX_MESSAGES",
  MAX_MESSAGE_CHARS: "CHAT_MAX_MESSAGE_CHARS",
  MAX_CONTEXT_CHARS: "CHAT_MAX_CONTEXT_CHARS",
  KEEP_LAST_TURNS: "CHAT_KEEP_LAST_TURNS",
  TOKENIZER: "CHAT_TOKENIZER",
  /** SSE 续传缓冲：最大条数（5A） */
  BUFFER_MAX_EVENTS: "CHAT_BUFFER_MAX_EVENTS",
  /** SSE 续传缓冲：最大 UTF-8 字节（5A） */
  BUFFER_MAX_BYTES: "CHAT_BUFFER_MAX_BYTES",
} as const;

/** M5 限流：env 键名集中枚举 */
export const RATE_LIMIT_ENV_KEYS = {
  WINDOW_MS: "CHAT_RATE_LIMIT_WINDOW_MS",
  USER_MAX: "CHAT_RATE_LIMIT_USER_MAX",
  IP_MAX: "CHAT_RATE_LIMIT_IP_MAX",
  TRUST_PROXY: "TRUST_PROXY",
  STRICT: "CHAT_RATE_LIMIT_STRICT",
} as const;

/** M8 会话存储：与 M5 限流窗口独立配置（design-m10-m8-m11） */
export const SESSION_STORE_ENV_KEYS = {
  /** `memory` | `redis`；默认 memory */
  STORE: "CHAT_SESSION_STORE",
  /** 会话键 TTL（毫秒），与 CHAT_RATE_LIMIT_WINDOW_MS 语义分离 */
  TTL_MS: "CHAT_SESSION_TTL_MS",
  /** 可选：仅会话走独立 Redis；未设则与 M5 共用 REDIS_URL / Upstash */
  REDIS_URL: "CHAT_SESSION_REDIS_URL",
} as const;

const DEFAULTS = {
  maxMessages: 100,
  maxMessageChars: 16000,
  maxContextChars: 120000,
  keepLastTurns: 20,
  /** 默认较宽松，便于与旧版「无界缓冲」回归一致；生产可调 env */
  bufferMaxEvents: 50_000,
  bufferMaxBytes: 50_000_000,
} as const;

const RATE_DEFAULTS = {
  windowMs: 60_000,
  userMax: 60,
  ipMax: 120,
} as const;

const SESSION_DEFAULTS = {
  /** 与 MemoryStreamSessionStore 延迟清理量级一致（10min） */
  ttlMs: 10 * 60 * 1000,
} as const;

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export type ChatErrorCode =
  | "VALIDATION_TOO_MANY_MESSAGES"
  | "VALIDATION_MESSAGE_TOO_LONG"
  | "VALIDATION_INVALID_ROLE"
  | "VALIDATION_EMPTY_CONTENT"
  | "BUDGET_CONTEXT_EXCEEDED"
  | "BUDGET_CONTEXT_STILL_EXCEEDED_AFTER_TRIM";

function parsePositiveInt(
  envKey: string,
  raw: string | undefined,
  fallback: number,
): number {
  if (raw === undefined || raw === "") return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) {
    chatLog("warn", "env_parse_failed", {
      code: "ENV_INVALID_POSITIVE_INT",
      reason: envKey,
      contentLength: raw.length,
    });
    return fallback;
  }
  return n;
}

/** 是否启用 tokenizer 分支（启发式 token 估算，见 budget.ts） */
export function isTokenizerEnabled(): boolean {
  const v = process.env[CHAT_ENV_KEYS.TOKENIZER];
  return v === "1" || v === "true";
}

export type ChatLimits = {
  maxMessages: number;
  maxMessageChars: number;
  maxContextChars: number;
  keepLastTurns: number;
};

/** SSE 续传环形缓冲上限（5A），与 StreamSessionStore.appendEvent 共用 */
export type BufferLimits = {
  maxEvents: number;
  maxBytes: number;
};

export type RateLimitConfig = {
  windowMs: number;
  userMax: number;
  ipMax: number;
  trustProxy: boolean;
  strict: boolean;
};

function parseBoolEnv(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw === "") return fallback;
  return raw === "1" || raw.toLowerCase() === "true";
}

/** 滑动窗口与 user/ip 配额；非法 env 回退默认值（与 M1 策略一致） */
export function getRateLimitConfig(): RateLimitConfig {
  const windowMs = clamp(
    parsePositiveInt(
      RATE_LIMIT_ENV_KEYS.WINDOW_MS,
      process.env[RATE_LIMIT_ENV_KEYS.WINDOW_MS],
      RATE_DEFAULTS.windowMs,
    ),
    1000,
    86_400_000,
  );
  const userMax = clamp(
    parsePositiveInt(
      RATE_LIMIT_ENV_KEYS.USER_MAX,
      process.env[RATE_LIMIT_ENV_KEYS.USER_MAX],
      RATE_DEFAULTS.userMax,
    ),
    1,
    1_000_000,
  );
  const ipMax = clamp(
    parsePositiveInt(
      RATE_LIMIT_ENV_KEYS.IP_MAX,
      process.env[RATE_LIMIT_ENV_KEYS.IP_MAX],
      RATE_DEFAULTS.ipMax,
    ),
    1,
    1_000_000,
  );
  return {
    windowMs,
    userMax,
    ipMax,
    trustProxy: parseBoolEnv(process.env[RATE_LIMIT_ENV_KEYS.TRUST_PROXY], false),
    strict: parseBoolEnv(process.env[RATE_LIMIT_ENV_KEYS.STRICT], false),
  };
}

export function getChatLimits(): ChatLimits {
  return {
    maxMessages: parsePositiveInt(
      CHAT_ENV_KEYS.MAX_MESSAGES,
      process.env[CHAT_ENV_KEYS.MAX_MESSAGES],
      DEFAULTS.maxMessages,
    ),
    maxMessageChars: parsePositiveInt(
      CHAT_ENV_KEYS.MAX_MESSAGE_CHARS,
      process.env[CHAT_ENV_KEYS.MAX_MESSAGE_CHARS],
      DEFAULTS.maxMessageChars,
    ),
    maxContextChars: parsePositiveInt(
      CHAT_ENV_KEYS.MAX_CONTEXT_CHARS,
      process.env[CHAT_ENV_KEYS.MAX_CONTEXT_CHARS],
      DEFAULTS.maxContextChars,
    ),
    keepLastTurns: parsePositiveInt(
      CHAT_ENV_KEYS.KEEP_LAST_TURNS,
      process.env[CHAT_ENV_KEYS.KEEP_LAST_TURNS],
      DEFAULTS.keepLastTurns,
    ),
  };
}

/** 续传缓冲条数/字节上限；非法 env 回退默认值 */
/** `memory` | `redis`；非法值回退 memory */
export function getSessionStoreKind(): "memory" | "redis" {
  const raw = process.env[SESSION_STORE_ENV_KEYS.STORE]?.toLowerCase()?.trim();
  if (raw === "redis") return "redis";
  return "memory";
}

/** 会话数据 TTL（毫秒），用于 Redis EXPIRE；与限流窗口无关 */
export function getChatSessionTtlMs(): number {
  return clamp(
    parsePositiveInt(
      SESSION_STORE_ENV_KEYS.TTL_MS,
      process.env[SESSION_STORE_ENV_KEYS.TTL_MS],
      SESSION_DEFAULTS.ttlMs,
    ),
    10_000,
    86_400_000,
  );
}

/** Redis EXPIRE 用秒（至少 1） */
export function getChatSessionTtlSec(): number {
  return Math.max(1, Math.ceil(getChatSessionTtlMs() / 1000));
}

export function getBufferLimits(): BufferLimits {
  const maxEvents = clamp(
    parsePositiveInt(
      CHAT_ENV_KEYS.BUFFER_MAX_EVENTS,
      process.env[CHAT_ENV_KEYS.BUFFER_MAX_EVENTS],
      DEFAULTS.bufferMaxEvents,
    ),
    1,
    10_000_000,
  );
  const maxBytes = clamp(
    parsePositiveInt(
      CHAT_ENV_KEYS.BUFFER_MAX_BYTES,
      process.env[CHAT_ENV_KEYS.BUFFER_MAX_BYTES],
      DEFAULTS.bufferMaxBytes,
    ),
    1,
    1_000_000_000,
  );
  return { maxEvents, maxBytes };
}
