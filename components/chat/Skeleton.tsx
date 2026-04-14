// 消息骨架屏
export function MessageSkeleton() {
  return (
    <div className="flex gap-3 animate-pulse">
      <div className="w-8 h-8 rounded-full bg-primary-700 shrink-0" />
      <div className="flex flex-col gap-2 flex-1 pt-1">
        <div className="h-3 bg-primary-700 rounded w-3/4" />
        <div className="h-3 bg-primary-700 rounded w-1/2" />
        <div className="h-3 bg-primary-700 rounded w-2/3" />
      </div>
    </div>
  );
}

// 会话列表骨架屏
export function ConversationSkeleton() {
  return (
    <div className="flex flex-col gap-2 px-4 py-2 animate-pulse">
      {[80, 60, 70].map((w, i) => (
        <div key={i} className={`h-3 bg-primary-700 rounded`} style={{ width: `${w}%` }} />
      ))}
    </div>
  );
}