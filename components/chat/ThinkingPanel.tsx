"use client";
import { useState } from "react";
import { ChevronDown, Brain } from "lucide-react";

interface Props {
  content: string;
  isStreaming?: boolean;
  className?: string;
}

export function ThinkingPanel({ content, isStreaming = false, className = "" }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <div
      className={`w-full min-w-0 rounded-xl border border-primary-700 bg-primary-900/60 overflow-hidden ${className}`}
    >
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2 text-xs
                   text-primary-400 hover:text-primary-200 transition-colors"
      >
        <Brain size={12} className="text-accent-400 shrink-0" />
        <span>查看推理过程</span>
        <ChevronDown
          size={12}
          className={`ml-auto transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>
      <div
        className={`overflow-hidden transition-all duration-200 ${open ? "max-h-96" : "max-h-0"}`}
      >
        <div className="px-3 pb-3 pt-1 text-xs text-primary-400 whitespace-pre-wrap
                        leading-relaxed border-t border-primary-700/60 overflow-y-auto max-h-64">
          {content}
          {isStreaming && (
            <span className="inline-block w-1 h-3 bg-accent-400 animate-pulse ml-0.5 align-middle" />
          )}
        </div>
      </div>
    </div>
  );
}