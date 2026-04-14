// utils/streamConsumer.ts
import type { SSEWriter } from "@/lib/sseServer/streamSession";
import type { Message, ToolCallBuffer } from "../types"; // 共享类型定义（见文末说明）

/**
 * DeepSeek 流式响应中单个 chunk 的结构
 * （兼容 OpenAI 格式并包含 reasoning_content 扩展）
 */
interface DeepSeekChunk {
  choices?: Array<{
    delta?: {
      content?: string | null;
      reasoning_content?: string | null; // DeepSeek-R1 特有
      tool_calls?: Array<{
        index: number;          // 工具调用在数组中的索引，用于区分多个并发的工具调用
        id?: string;            // 工具调用的唯一标识，通常在第一个分片中提供
        function?: {
          name?: string;        // 函数名，可能只在第一个分片中完整出现
          arguments?: string;   // 参数的 JSON 字符串片段，可能跨多个分片累积
        };
      }>;
    };
    finish_reason?: string | null; // 流结束原因，如 "stop"、"tool_calls" 等
  }>;
}

/**
 * 消费 LLM 的原始 ReadableStream，边解析边向 writer 写入 SSE 事件，
 * 并返回累积的工具调用、拼装好的 assistant 消息以及累积的 content。
 *
 * @param llmStream - 来自 LLM 的原始流（例如 fetch 响应的 body）
 * @param writeSSE  - 写入 SSE 事件（含 id 与缓冲）
 * @returns 包含累积工具调用、完整助手消息和内容缓冲区的 Promise
 */
export async function consumeLLMStream(
  llmStream: ReadableStream<Uint8Array>,
  writeSSE: SSEWriter
): Promise<{
  toolCalls: ToolCallBuffer[];
  assistantMessage: Message;
  contentBuffer: string;
  /** 累积的 reasoning_content（用于 deepseek-reasoner 仅有推理、无正文 content 时的补发 delta） */
  reasoningBuffer: string;
}> {
  // 创建文本解码器，用于将 Uint8Array 解码为字符串（stream: true 表示可能跨块解码）
  const decoder = new TextDecoder();
  // 用于暂存多个工具调用，键为 index，值为累积的 ToolCallBuffer 对象
  const toolBuffer = new Map<number, ToolCallBuffer>();
  // 累积普通文本内容（非工具调用）
  let contentBuffer = "";
  // 累积推理链（与 thinking 事件同源）
  let reasoningBuffer = "";

  // 从 llmStream 获取一个读取器，用于逐块读取数据
  const reader = llmStream.getReader();

  try {
    // 循环读取流中的每一个数据块（chunk）
    while (true) {
      const { done, value } = await reader.read();
      // 如果流已结束，退出循环
      if (done) break;

      // 将当前块的 Uint8Array 解码为字符串，stream: true 表示可能是不完整的 UTF-8 序列
      const text = decoder.decode(value, { stream: true });

      // 将文本按行分割，处理每一行
      for (const line of text.split("\n")) {
        // 只处理以 "data: " 开头的行，这是 Server-Sent Events 的标准格式
        if (!line.startsWith("data: ")) continue;

        // 去除 "data: " 前缀，并去掉首尾空白
        const raw = line.slice(6).trim();

        // 如果是流结束标志 [DONE]，则跳过（外层会在 while 循环结束后处理 done 事件）
        if (raw === "[DONE]") continue;

        let parsed: DeepSeekChunk;
        try {
          // 尝试将 JSON 字符串解析为 DeepSeekChunk 对象
          parsed = JSON.parse(raw) as DeepSeekChunk;
        } catch {
          // 如果解析失败（例如非 JSON 的心跳消息），忽略该行
          continue;
        }

        // 获取第一个 choice（通常只有一个），如果没有则跳过
        const choice = parsed.choices?.[0];
        if (!choice) continue;

        const delta = choice.delta;

        // 1. 处理思考链内容（DeepSeek-R1 / deepseek-reasoner 特有）—— 发送 "thinking" 事件给客户端
        if (delta?.reasoning_content) {
          reasoningBuffer += delta.reasoning_content;
          await writeSSE("thinking", { content: delta.reasoning_content });
        }

        // 2. 处理普通文本增量 —— 发送 "delta" 事件给客户端
        if (delta?.content) {
          contentBuffer += delta.content; // 累积到本地缓冲区
          await writeSSE("delta", { content: delta.content });
        }

        // 3. 处理工具调用增量 —— 这些增量可能是多个分片，需要按 index 合并
        if (delta?.tool_calls?.length) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index; // 工具调用在数组中的索引
            const existing = toolBuffer.get(idx);

            if (!existing) {
              // 如果该索引的工具调用尚未创建，则初始化一个新对象
              // 注意：第一个分片中可能包含 id 和 name，也可能没有，这里使用默认值
              toolBuffer.set(idx, {
                id: tc.id ?? `tool-${idx}`,          // 如果没有 id，则生成一个临时 id
                name: tc.function?.name ?? "",        // 函数名，可能为空
                arguments: tc.function?.arguments ?? "", // 参数片段
              });
            } else {
              // 如果已经存在，则将本次的 arguments 片段追加到已有字符串后
              existing.arguments += tc.function?.arguments ?? "";
              // 如果后续分片中提供了更完整的 id 或 name，则更新
              if (tc.id) existing.id = tc.id;
              if (tc.function?.name) existing.name = tc.function.name;
            }
          }
        }
      }
    }
  } finally {
    // 无论成功或异常，都释放读取器的锁，允许其他读取器使用该流
    reader.releaseLock();
  }

  // 将工具缓冲区中的值（按索引顺序）转换为数组
  const toolCalls = [...toolBuffer.values()];

  // 构建完整的 assistant 消息，用于后续添加到消息历史中
  const assistantMessage: Message =
    toolCalls.length > 0
      ? {
        role: "assistant",
        content: null, // 当有工具调用时，content 通常为 null
        tool_calls: toolCalls.map((tc) => ({
          id: tc.id,
          type: "function" as const, // 固定为 function 类型
          function: { name: tc.name, arguments: tc.arguments },
        })),
      }
      : {
        role: "assistant",
        // 若仅有 reasoning、无正文，仍把推理写入 assistant 消息，便于服务端后续轮次上下文一致
        content: contentBuffer || reasoningBuffer,
      };

  // 返回所有累积的数据
  return { toolCalls, assistantMessage, contentBuffer, reasoningBuffer };
}