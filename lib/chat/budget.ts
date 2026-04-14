/**
 * 上下文预算：默认按 Unicode 码点计量；CHAT_TOKENIZER=1 时使用启发式 token 估算（无额外 npm）。
 * 裁剪：保留 system 占位；从头部删整轮，直至低于上限或仅保留最近 keepLastTurns 轮。
 */
import { chatLog } from "@/lib/observability/chatLog";
import {
  getChatLimits,
  isTokenizerEnabled,
  type ChatErrorCode,
} from "@/lib/chat/limits";
import type { Message } from "@/types/chat";

export class ChatBudgetError extends Error {
  readonly code: ChatErrorCode;

  constructor(code: ChatErrorCode, message?: string) {
    super(message ?? code);
    this.name = "ChatBudgetError";
    this.code = code;
  }
}

/** Unicode 码点长度（与 validateRequest 中单条长度一致） */
export function countCodePoints(s: string): number {
  return [...s].length;
}

/**
 * 启发式 token 估算（启用 TOKENIZER 时）：约 4 码点/ token，与常见英文近似；无原生依赖。
 * 若需精算可在此替换为 tiktoken 等。
 */
export function estimateTokensApprox(s: string): number {
  const cp = countCodePoints(s);
  return Math.max(1, Math.ceil(cp / 4));
}

function messageFootprint(m: Message, mode: "chars" | "tokens"): number {
  const base = `${m.content ?? ""}${m.thinking ?? ""}`;
  if (mode === "chars") {
    return countCodePoints(base);
  }
  return estimateTokensApprox(base);
}

function totalFootprint(messages: Message[], mode: "chars" | "tokens"): number {
  let sum = 0;
  for (const m of messages) {
    sum += messageFootprint(m, mode);
  }
  return sum;
}

/** 以 user 起始分段为「轮」（含其后连续 assistant，直到下一 user） */
export function splitIntoTurns(messages: Message[]): Message[][] {
  const turns: Message[][] = [];
  let current: Message[] = [];
  for (const m of messages) {
    if (m.role === "user" && current.length > 0) {
      turns.push(current);
      current = [m];
    } else {
      current.push(m);
    }
  }
  if (current.length) turns.push(current);
  return turns;
}

function flattenTurns(turns: Message[][]): Message[] {
  const out: Message[] = [];
  for (const t of turns) out.push(...t);
  return out;
}

export function trimMessagesToBudget(
  messages: Message[],
  policy: {
    maxContextChars: number;
    keepLastTurns: number;
    preserveSystem: boolean;
    /** 未传时按 `isTokenizerEnabled()` 与 design 一致 */
    measureMode?: "chars" | "tokens";
  },
): { messages: Message[]; removedCount: number; trimmed: boolean } {
  const mode =
    policy.measureMode ??
    (isTokenizerEnabled() ? "tokens" : "chars");
  // preserveSystem：当前 Message 无 system，预留
  void policy.preserveSystem;

  const maxUnits = policy.maxContextChars;
  const keepLast = policy.keepLastTurns;

  const turns = splitIntoTurns(messages);
  if (turns.length === 0) {
    return { messages: [], removedCount: 0, trimmed: false };
  }

  const tail = turns.slice(-keepLast);
  const tailFlat = flattenTurns(tail);
  const tailSize = totalFootprint(tailFlat, mode);

  if (tailSize > maxUnits) {
    chatLog("warn", "context_rejected", {
      code: "BUDGET_CONTEXT_EXCEEDED",
      reason: "tail_exceeds_budget",
      contentLength: tailSize,
    });
    throw new ChatBudgetError("BUDGET_CONTEXT_EXCEEDED");
  }

  let working = [...turns];
  let removed = 0;
  while (
    working.length > keepLast &&
    totalFootprint(flattenTurns(working), mode) > maxUnits
  ) {
    const dropped = working.shift();
    if (dropped) removed += dropped.length;
  }

  const result = flattenTurns(working);
  const trimmed =
    removed > 0 ||
    (messages.length > 0 && result.length < messages.length);

  if (totalFootprint(result, mode) > maxUnits) {
    chatLog("warn", "context_rejected", {
      code: "BUDGET_CONTEXT_STILL_EXCEEDED_AFTER_TRIM",
      reason: "still_over_after_trim",
    });
    throw new ChatBudgetError("BUDGET_CONTEXT_STILL_EXCEEDED_AFTER_TRIM");
  }

  if (trimmed) {
    chatLog("info", "context_trimmed", {
      reason: "head_turns_removed",
      removedMessageCount: removed,
    });
  }

  return { messages: result, removedCount: removed, trimmed };
}

/**
 * 按当前 limits 与 tokenizer 开关应用预算；超限先裁剪，仍超则抛错。
 * opts.mode 显式指定计量方式（通常与 isTokenizerEnabled() 一致）。
 */
export function applyBudgetOrThrow(
  messages: Message[],
  opts: { mode: "chars" | "tokens" },
): { messages: Message[]; trimmed: boolean } {
  const limits = getChatLimits();
  const maxUnits = limits.maxContextChars;
  const total = totalFootprint(messages, opts.mode);

  if (total <= maxUnits) {
    return { messages, trimmed: false };
  }

  const { messages: trimmed, trimmed: didTrim } = trimMessagesToBudget(
    messages,
    {
      maxContextChars: maxUnits,
      keepLastTurns: limits.keepLastTurns,
      preserveSystem: false,
      measureMode: opts.mode,
    },
  );

  if (totalFootprint(trimmed, opts.mode) > maxUnits) {
    chatLog("warn", "context_rejected", {
      code: "BUDGET_CONTEXT_STILL_EXCEEDED_AFTER_TRIM",
      reason: "apply_budget_still_over",
    });
    throw new ChatBudgetError("BUDGET_CONTEXT_STILL_EXCEEDED_AFTER_TRIM");
  }

  return { messages: trimmed, trimmed: didTrim };
}
