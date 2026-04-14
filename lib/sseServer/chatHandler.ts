// 导入流式聊天补全函数，用于调用 AI 模型并获取流式响应
import { streamChatCompletion } from "@/lib/ai/provider";
// 导入工具执行函数和工具定义列表
import { executeTool, TOOL_DEFINITIONS } from "@/lib/sseServer/aiTools";
// 导入消费 LLM 流的函数，该函数会解析流并调用 writeSSE 发送事件
import { consumeLLMStream } from "@/lib/sseServer/consumeLLMStream";
// 导入创建 SSE 写入器、创建流会话、标记会话完成/错误的函数
import {
  createSSEWriterWithBufferLimits,
  createStreamSession,
  markSessionDone,
  markSessionError,
} from "@/lib/sseServer/streamSession";
import type { StreamSessionStore } from "@/lib/sseServer/streamSessionStore";
// 导入消息类型定义
import type { Message } from "../types";

// 定义最大工具调用轮次，防止无限循环（AI 不断调用工具）
const MAX_TOOL_ROUNDS = 5;

/**
 * 处理聊天流的主函数
 * @param initialMessages 初始消息列表（对话历史）
 * @param writer HTTP 响应流的写入器，用于向客户端发送数据
 * @param encoder 文本编码器，用于将字符串转为 Uint8Array
 * @param guestId 访客 ID，用于工具执行时的身份识别
 * @param store 续传缓冲存储（M10 注入，避免热路径隐式单例）
 */
export async function handleChatStream(
  initialMessages: Message[],
  writer: WritableStreamDefaultWriter<Uint8Array>,
  encoder: TextEncoder,
  guestId: string,
  store: StreamSessionStore
) {
  // 创建一个新的流会话，用于存储该次对话的缓冲事件，便于断点续传
  const session = await createStreamSession(guestId, store);
  // 创建一个可变引用指向当前的 writer（因为 writer 可能在客户端断开时被置空）
  const writerRef = { current: writer };
  // 创建 SSE 写入器：经 StreamSessionStore.appendEvent（5A）缓冲并尝试推送
  const writeSSE = createSSEWriterWithBufferLimits(session, encoder, writerRef, store);

  try {
    // 复制初始消息，以便在工具调用过程中不断追加新消息
    const messages: Message[] = [...initialMessages];

    // 循环处理工具调用，最多 MAX_TOOL_ROUNDS 轮
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      // 调用 AI 模型获取流式聊天补全，传入当前消息列表和可用工具定义
      const llmStream = await streamChatCompletion(messages, TOOL_DEFINITIONS);
      // 消费 LLM 流，解析出工具调用、助手消息、内容缓冲、推理缓冲等，并通过 writeSSE 发送事件
      const { toolCalls, assistantMessage, contentBuffer, reasoningBuffer } =
        await consumeLLMStream(llmStream, writeSSE);

      // 如果没有工具调用，说明本轮 AI 直接回复内容，可以结束循环
      if (toolCalls.length === 0) {
        // 如果内容为空但推理内容非空，则将推理内容作为 delta 发送（某些模型可能只返回推理）
        if (!contentBuffer.trim() && reasoningBuffer.trim()) {
          await writeSSE("delta", { content: reasoningBuffer });
        }
        break; // 结束循环
      }

      // 有工具调用，将助手消息（包含工具调用）加入到消息列表中
      messages.push(assistantMessage);

      // 遍历每个工具调用
      for (const tc of toolCalls) {
        let parsedInput: Record<string, unknown> | undefined;
        // 尝试解析工具调用的参数 JSON
        try {
          parsedInput = JSON.parse(tc.arguments) as Record<string, unknown>;
        } catch {
          // 解析失败则保持 undefined，后续会显示为原始字符串
          parsedInput = undefined;
        }

        // 发送 tool_call 事件，状态为 running（开始执行）
        await writeSSE("tool_call", {
          id: tc.id,
          name: tc.name,
          arguments: tc.arguments,
          input: parsedInput,
          status: "running",
        });

        let toolResultContent: string;
        try {
          // 解析工具参数（第二次解析，与上面类似，但这里用于执行）
          const args = JSON.parse(tc.arguments) as Record<string, unknown>;
          // 执行工具，传入 guestId 用于权限/上下文
          const result = await executeTool(tc.name, args, { guestId });
          // 将执行结果序列化为字符串，存入工具结果
          toolResultContent = JSON.stringify(result);

          // 发送 tool_call 事件，状态为 done（执行成功），并附带输出结果
          await writeSSE("tool_call", {
            id: tc.id,
            name: tc.name,
            arguments: tc.arguments,
            input: parsedInput,
            status: "done",
            output: result,
          });
        } catch (err) {
          // 工具执行失败，构造错误信息
          const message = err instanceof Error ? err.message : "Tool execution failed";
          toolResultContent = JSON.stringify({ error: message });
          // 发送 tool_call 事件，状态为 error
          await writeSSE("tool_call", {
            id: tc.id,
            name: tc.name,
            arguments: tc.arguments,
            input: parsedInput,
            status: "error",
            error: message,
          });
        }

        // 将工具执行结果作为一条 tool 角色消息加入消息列表，供下一轮 AI 调用使用
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: toolResultContent,
        });
      }
    }

    // 所有处理完成，发送 done 事件，表示流结束
    await writeSSE("done", {});
    // 将会话状态标记为 done，并安排延迟清理
    await markSessionDone(session.streamId, store);
  } catch (err) {
    // 出现异常，将会话状态标记为 error，并安排延迟清理
    await markSessionError(session.streamId, store);
    // 重新抛出异常，让上层处理（例如路由中捕获并发送 error 事件）
    throw err;
  }
}