export function createSSEBuffer(onFlush: (text: string) => void) {
  let queue: string[] = [];           // 存储尚未刷新的文本块
  let rafId: number | null = null;    // requestAnimationFrame 的 ID

  // 刷新函数：将队列中的内容合并后通过 onFlush 回调传出，并清空队列
  function flush() {
    if (queue.length === 0) return;
    const batch = queue.join("");      // 合并所有块
    queue = [];
    rafId = null;
    onFlush(batch);
  }

  // 推入新块：将块加入队列，如果没有待执行的刷新，则请求下一帧执行 flush
  function push(chunk: string) {
    queue.push(chunk);
    if (rafId === null) {
      rafId = requestAnimationFrame(flush);
    }
  }

  // 清空缓冲区：取消待执行的动画帧，并清空队列
  function clear() {
    queue = [];
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  return { push, clear };
}