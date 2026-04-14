"use client";
import { Plus, Trash2, MessageSquare, Eraser } from "lucide-react";
import { useChatStore } from "@/store/chatStore";
import { clearChatPersistence } from "@/lib/chat/chatPersistence";
import { clearAllChatDrafts } from "@/lib/chat/chatDraftStorage";

export function ConversationList() {
  const { conversations, activeId, createConversation, deleteConversation, setActiveId, clearAllConversations } =
    useChatStore();

  const handleClearAllLocal = async () => {
    if (typeof window !== "undefined" && !window.confirm("确定清空本机所有对话与草稿？")) return;
    await clearChatPersistence();
    clearAllChatDrafts();
    clearAllConversations();
  };

  return (
    <div className="flex flex-col h-full bg-primary-950">
      {/* 头部 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-primary-700 shrink-0">
        <span className="text-xs font-semibold text-primary-400 uppercase tracking-wider">对话历史</span>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => void handleClearAllLocal()}
            title="清空本机全部对话"
            className="p-1.5 text-primary-500 hover:text-amber-400/90 transition-colors rounded-lg hover:bg-primary-800"
          >
            <Eraser size={15} />
          </button>
          <button
            onClick={() => createConversation()}
            title="新建对话"
            className="p-1.5 text-primary-400 hover:text-accent-400 transition-colors rounded-lg hover:bg-primary-800"
          >
            <Plus size={15} />
          </button>
        </div>
      </div>

      {/* 列表 */}
      <div className="flex-1 overflow-y-auto py-1">
        {conversations.length === 0 && (
          <p className="text-xs text-primary-600 text-center py-8">暂无历史对话</p>
        )}
        {conversations.map((conv) => (
          <div
            key={conv.id}
            onClick={() => setActiveId(conv.id)}
            className={`
              group flex items-center gap-2 px-3 py-2.5 mx-1 rounded-lg
              cursor-pointer transition-colors text-sm
              ${activeId === conv.id
                ? "bg-primary-800 text-primary-100"
                : "text-primary-400 hover:bg-primary-800/60 hover:text-primary-200"
              }
            `}
          >
            <MessageSquare size={13} className="shrink-0 opacity-50" />
            <span className="flex-1 truncate text-xs">{conv.title}</span>
            <button
              onClick={(e) => { e.stopPropagation(); deleteConversation(conv.id); }}
              className="hidden group-hover:flex items-center text-primary-600
                         hover:text-red-400 transition-colors shrink-0"
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}