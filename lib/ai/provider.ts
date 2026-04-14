const DEEPSEEK_API_URL = "https://api.deepseek.com/chat/completions";

type ProviderChatMessage = {
  role: string;
  content: string | null;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
};

export async function streamChatCompletion(
  messages: ProviderChatMessage[],
  tools?: ReadonlyArray<unknown>
) {
  const res = await fetch(DEEPSEEK_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model: "deepseek-reasoner",
      messages,
      stream: true, // 以流式方式返回数据
      ...(tools ? { tools } : {}),
    }),
  });

  if (!res.ok) {
    const error = await res.text();
    console.error(error);
    throw new Error(error);
  }

  return res.body!;//ReadableStream 对象
}
