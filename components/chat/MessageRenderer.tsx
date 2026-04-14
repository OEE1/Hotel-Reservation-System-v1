"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github-dark.css";
import { autoCloseMarkdown } from "@/lib/chat/mdAutoClose";


interface MessageRendererProps {
  content: string;
  /** 流式输出中时传 true，触发自动补全逻辑 */
  streaming?: boolean;
}

export function MessageRenderer({ content, streaming = false }: MessageRendererProps) {
  const safeContent = streaming ? autoCloseMarkdown(content) : content;

  return (
    <div className="prose prose-invert prose-sm max-w-none leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          // 行内代码
          code({ className, children, ...props }) {
            const isBlock = /language-/.test(className ?? "");
            return isBlock ? (
              <code className={className} {...props}>
                {children}
              </code>
            ) : (
              <code
                className="bg-primary-700 text-accent-300 rounded px-1 py-0.5 text-xs"
                {...props}
              >
                {children}
              </code>
            );
          },
          // 代码块容器
          pre({ children }) {
            return (
              <pre className="bg-primary-950 rounded-lg p-4 overflow-x-auto text-xs">
                {children}
              </pre>
            );
          },
          // 表格
          table({ children }) {
            return (
              <div className="overflow-x-auto">
                <table className="border-collapse w-full text-xs">{children}</table>
              </div>
            );
          },
          th({ children }) {
            return (
              <th className="border border-primary-600 px-3 py-1 bg-primary-800 text-left">
                {children}
              </th>
            );
          },
          td({ children }) {
            return (
              <td className="border border-primary-600 px-3 py-1">{children}</td>
            );
          },
        }}
      >
        {safeContent}
      </ReactMarkdown>
    </div>
  );
}