// lib/chat/mdAutoClose.ts
export function autoCloseMarkdown(text: string): string {
  let result = text;

  // 补全未闭合的代码块
  const codeBlockCount = (result.match(/```/g) ?? []).length;
  if (codeBlockCount % 2 !== 0) result += "\n```";

  // 补全未闭合的加粗
  const boldCount = (result.match(/\*\*/g) ?? []).length;
  if (boldCount % 2 !== 0) result += "**";

  // 补全未闭合的删除线
  const strikeCount = (result.match(/~~/g) ?? []).length;
  if (strikeCount % 2 !== 0) result += "~~";

  return result;
}