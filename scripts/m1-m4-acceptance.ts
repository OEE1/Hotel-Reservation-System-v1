/**
 * M1–M4 模块验收脚本：不依赖 Next dev，直接跑 Node。
 * 用法（项目根目录）：npx tsx scripts/m1-m4-acceptance.ts
 */
import { CHAT_ENV_KEYS, getChatLimits, isTokenizerEnabled } from "../lib/chat/limits";
import {
  applyBudgetOrThrow,
  countCodePoints,
  trimMessagesToBudget,
} from "../lib/chat/budget";
import {
  ChatValidationError,
  validateChatRequestBody,
} from "../lib/chat/validateRequest";
import type { Message } from "../types/chat";

function assert(cond: boolean, message: string): void {
  if (!cond) throw new Error(`[FAIL] ${message}`);
}

const CHAT_KEYS = Object.values(CHAT_ENV_KEYS);

function clearChatEnv(): void {
  for (const k of CHAT_KEYS) delete process.env[k];
}

function msg(id: string, role: "user" | "assistant", content: string): Message {
  return {
    id,
    role,
    content,
    createdAt: Date.now(),
  };
}

let passed = 0;
function ok(name: string): void {
  passed += 1;
  console.log(`[OK] ${name}`);
}

function run(): void {
  const saved: Record<string, string | undefined> = {};
  for (const k of CHAT_KEYS) saved[k] = process.env[k];

  try {
    // —— M1：默认值（清空 CHAT_*，避免 .env.local 干扰本段断言）——
    clearChatEnv();
    const d = getChatLimits();
    assert(d.maxMessages === 100, "default maxMessages");
    assert(d.maxMessageChars === 16000, "default maxMessageChars");
    assert(d.maxContextChars === 120000, "default maxContextChars");
    assert(d.keepLastTurns === 20, "default keepLastTurns");
    assert(isTokenizerEnabled() === false, "tokenizer off by default");
    ok("M1 defaults with CHAT_* unset");

    process.env[CHAT_ENV_KEYS.MAX_MESSAGES] = "50";
    assert(getChatLimits().maxMessages === 50, "env override maxMessages");
    ok("M1 CHAT_MAX_MESSAGES=50");

    process.env[CHAT_ENV_KEYS.MAX_MESSAGES] = "not-a-number";
    assert(getChatLimits().maxMessages === 100, "invalid env falls back");
    ok("M1 invalid CHAT_MAX_MESSAGES falls back to 100");

    clearChatEnv();

    // —— M3 ——
    try {
      validateChatRequestBody({ messages: [] }, "chat");
      throw new Error("expected ChatValidationError");
    } catch (e) {
      assert(
        e instanceof ChatValidationError && e.code === "VALIDATION_EMPTY_CONTENT",
        "chat mode empty messages",
      );
    }
    ok("M3 chat mode rejects empty messages");

    validateChatRequestBody({}, "resume");
    ok("M3 resume mode allows no messages");

    try {
      const badRole = [
        { id: "1", role: "user" as const, content: "hi", createdAt: 0 },
        { id: "2", role: "system" as never, content: "x", createdAt: 0 },
      ] as unknown as Message[];
      validateChatRequestBody({ messages: badRole }, "chat");
      throw new Error("expected ChatValidationError");
    } catch (e) {
      assert(
        e instanceof ChatValidationError && e.code === "VALIDATION_INVALID_ROLE",
        "invalid role",
      );
    }
    ok("M3 invalid role");

    // —— M4：裁剪（显式 chars，避免依赖 TOKENIZER）——
    const many: Message[] = [];
    for (let t = 0; t < 30; t += 1) {
      many.push(msg(`u${t}`, "user", "U".repeat(80)));
      many.push(msg(`a${t}`, "assistant", "A".repeat(80)));
    }
    const r = trimMessagesToBudget(many, {
      maxContextChars: 500,
      keepLastTurns: 2,
      preserveSystem: false,
      measureMode: "chars",
    });
    assert(r.trimmed === true, "should trim");
    assert(r.messages.length < many.length, "fewer messages after trim");
    const keptChars = r.messages.reduce(
      (s, m) => s + countCodePoints(m.content),
      0,
    );
    assert(keptChars <= 500, "result within maxContextChars");
    // 每轮 160 码点；500 下至少需 4 轮才超，故最少保留 3 轮 = 6 条（不必恰好等于 keepLastTurns 轮）
    assert(r.messages.length === 6, "3 turns × 2 messages under 500 chars");
    ok("M4 trimMessagesToBudget trims head turns (chars)");

    const small = trimMessagesToBudget(
      [msg("1", "user", "hello"), msg("2", "assistant", "hi")],
      {
        maxContextChars: 10_000,
        keepLastTurns: 20,
        preserveSystem: false,
        measureMode: "chars",
      },
    );
    assert(small.trimmed === false, "no trim when under budget");
    ok("M4 no trim when under budget");

    clearChatEnv();
    const under = applyBudgetOrThrow(
      [msg("1", "user", "a"), msg("2", "assistant", "b")],
      { mode: "chars" },
    );
    assert(under.trimmed === false, "applyBudgetOrThrow no trim");
    ok("M4 applyBudgetOrThrow under budget");

    console.log("");
    console.log(`All passed: ${passed} checks`);
  } finally {
    for (const k of CHAT_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

run();
