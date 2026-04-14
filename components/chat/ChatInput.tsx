"use client";
import { useRef, useState } from "react";
import { Send, Mic, Paperclip, X, Square } from "lucide-react";
import { useChatUIStore } from "@/store/chatUIStore";

interface Props {
  onSend: (text: string, fileUrl?: string, fileType?: string) => void;
  isResponding: boolean;
  onStop: () => void;
  /** 未登录或需强制展示登录提示时禁用输入与发送 */
  disabled?: boolean;
}

export function ChatInput({ onSend, isResponding, onStop, disabled = false }: Props) {
  const { inputText, setInputText } = useChatUIStore();
  const [pendingFile, setPendingFile] = useState<{ url: string; type: string; name: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (disabled) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (isResponding) onStop();
      else handleSend();
    }
  }

  function handleSend() {
    if (disabled) return;
    const trimmed = inputText.trim();
    if (!trimmed && !pendingFile) return;
    onSend(trimmed, pendingFile?.url, pendingFile?.type);
    setInputText("");
    setPendingFile(null);
    if (textRef.current) textRef.current.style.height = "40px";
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const url = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(file);
      });
      setPendingFile({ url, type: file.type, name: file.name });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const hasContent = inputText.trim() !== "" || pendingFile !== null;

  return (
    <div className="border-t border-primary-700 p-3 space-y-2 shrink-0">
      {pendingFile && (
        <div className="flex items-center gap-2 text-xs text-primary-300
                        bg-primary-800 rounded-lg px-3 py-2 border border-primary-700">
          <span className="truncate flex-1">📎 {pendingFile.name}</span>
          <button onClick={() => setPendingFile(null)} className="hover:text-red-400 transition-colors">
            <X size={13} />
          </button>
        </div>
      )}

      <div className="flex items-end gap-2">
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading || disabled}
          title="上传文件"
          className="p-2 text-primary-400 hover:text-accent-400 disabled:opacity-40 transition-colors shrink-0"
        >
          <Paperclip size={18} />
        </button>
        <input ref={fileRef} type="file" className="hidden" onChange={handleFileChange} />

        <textarea
          ref={textRef}
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={handleKeyDown}
          onInput={(e) => {
            const el = e.currentTarget;
            el.style.height = "40px";
            el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
          }}
          placeholder="输入消息… Enter 发送"
          rows={1}
          disabled={disabled}
          style={{
            minHeight: "40px",
            maxHeight: "160px",
          }}
          className="chat-input flex-1 resize-none bg-primary-800 text-primary-100 rounded-xl
           px-4 py-2.5 text-sm placeholder:text-primary-500
           border border-primary-600 focus:border-accent-500
           focus:outline-none disabled:opacity-50 overflow-y-auto hide-scrollbar"
        />

        <button
          title="语音输入（即将上线）"
          disabled={disabled}
          className="p-2 text-primary-400 hover:text-accent-400 disabled:opacity-40 transition-colors shrink-0"
        >
          <Mic size={18} />
        </button>

        {isResponding ? (
          <button
            onClick={onStop}
            disabled={disabled}
            title="停止生成"
            className="p-2.5 bg-red-500 text-white rounded-xl
                       hover:bg-red-600 disabled:opacity-40 transition-colors shrink-0"
          >
            <Square size={16} />
          </button>
        ) : (
          <button
            onClick={handleSend}
            disabled={disabled || !hasContent}
            className="p-2.5 bg-accent-500 text-primary-900 rounded-xl
                       hover:bg-accent-600 disabled:opacity-40 transition-colors shrink-0"
          >
            <Send size={16} />
          </button>
        )}
      </div>
    </div>
  );
}