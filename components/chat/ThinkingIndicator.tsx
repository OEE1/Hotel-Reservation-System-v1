import { Bot } from "lucide-react";

export function ThinkingIndicator() {
  return (
    <div className="flex gap-3 items-end">
      <div className="w-8 h-8 rounded-full bg-primary-700 flex items-center justify-center shrink-0">
        <Bot size={15} className="text-accent-400" />
      </div>
      <div className="bg-primary-800 rounded-2xl rounded-bl-sm px-4 py-3 flex items-center gap-1.5">
        <span className="w-2 h-2 bg-primary-400 rounded-full animate-bounce [animation-delay:0ms]" />
        <span className="w-2 h-2 bg-primary-400 rounded-full animate-bounce [animation-delay:150ms]" />
        <span className="w-2 h-2 bg-primary-400 rounded-full animate-bounce [animation-delay:300ms]" />
      </div>
    </div>
  );
}