// store/chatUIStore.ts
import { create } from "zustand";
import { immer } from "zustand/middleware/immer";

interface ChatUIStore {
  panelOpen: boolean;
  panelFullscreen: boolean;
  setPanelOpen: (v: boolean) => void;
  setPanelFullscreen: (v: boolean) => void;
  togglePanelOpen: () => void;
  togglePanelFullscreen: () => void;

  inputText: string;
  setInputText: (t: string) => void;
  clearInputText: () => void;

  /**
   * 用 AbortController 替代裸函数。
   * immer 会对 plain object 做 proxy，但 AbortController 是内置类实例，
   * 需要用 current() 或绕过 immer，这里选择单独一个 vanilla set 来写入。
   */
  _abortController: AbortController | null;
  /** 注册新的 AbortController，同时自动 abort 旧的 */
  registerAbort: (ctrl: AbortController | null) => void;
  /** 触发中止并清空 */
  abort: () => void;

  /** 会话过期或未登录导致 API 401 时置为 true，与 ChatPanel 登录提示联动 */
  authBlocked: boolean;
  setAuthBlocked: (v: boolean) => void;

  /** SSE 断线自动重连等待期间为 true，用于最后一条助手气泡提示 */
  streamReconnecting: boolean;
  setStreamReconnecting: (v: boolean) => void;

  /**
   * 每次用户点击「停止」递增；进行中的 sendMessage（含重试退避）若发现与启动时不一致则退出。
   */
  streamCancelGeneration: number;
  bumpStreamCancelGeneration: () => void;
}

export const useChatUIStore = create<ChatUIStore>()(
  immer((set, get) => ({
    panelOpen: false,
    panelFullscreen: false,

    setPanelOpen: (v) => set((s) => { s.panelOpen = v; }),
    setPanelFullscreen: (v) => set((s) => { s.panelFullscreen = v; }),
    // 补充 toggle 便捷方法，避免调用方写 setPanelOpen(!panelOpen)
    togglePanelOpen: () => set((s) => { s.panelOpen = !s.panelOpen; }),
    togglePanelFullscreen: () => set((s) => { s.panelFullscreen = !s.panelFullscreen; }),

    inputText: "",
    setInputText: (t) => set((s) => { s.inputText = t; }),
    clearInputText: () => set((s) => { s.inputText = ""; }),

    _abortController: null,

    registerAbort: (ctrl) => {
      // 先 abort 旧的，再注册新的，避免遗漏
      get()._abortController?.abort();
      // AbortController 是类实例，绕过 immer 直接 set
      set((s) => { s._abortController = ctrl; });
    },

    abort: () => {
      get()._abortController?.abort();
      set((s) => { s._abortController = null; });
    },

    authBlocked: false,
    setAuthBlocked: (v) => set((s) => { s.authBlocked = v; }),

    streamReconnecting: false,
    setStreamReconnecting: (v) => set((s) => { s.streamReconnecting = v; }),

    streamCancelGeneration: 0,
    bumpStreamCancelGeneration: () =>
      set((s) => {
        s.streamCancelGeneration += 1;
      }),
  }))
);