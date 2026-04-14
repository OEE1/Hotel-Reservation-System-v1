import { create } from "zustand";
import type { Session } from "next-auth";
import type { AuthStatus } from "@/lib/auth/authTypes";

interface AuthSessionStore {
  auth: AuthStatus;
  /** 供 apiFetch / 登出 与 UI 同步 */
  version: number;
  setAuth: (next: AuthStatus) => void;
  bumpVersion: () => void;
}

export const useAuthSessionStore = create<AuthSessionStore>((set) => ({
  auth: { status: "loading" },
  version: 0,
  setAuth: (next) => set({ auth: next }),
  bumpVersion: () => set((s) => ({ version: s.version + 1 })),
}));

export function getAuthSessionState(): AuthStatus {
  return useAuthSessionStore.getState().auth;
}

/** 供 apiFetch、SignOut、401 处理：清 zustand + 触发订阅方刷新 */
export function resetAuthToUnauthenticated(): void {
  useAuthSessionStore.getState().setAuth({ status: "unauthenticated" });
  useAuthSessionStore.getState().bumpVersion();
}

export function setAuthAuthenticated(session: Session, isStale: boolean): void {
  useAuthSessionStore.getState().setAuth({
    status: "authenticated",
    session,
    isStale,
  });
  useAuthSessionStore.getState().bumpVersion();
}

export function setAuthLoading(): void {
  useAuthSessionStore.getState().setAuth({ status: "loading" });
  useAuthSessionStore.getState().bumpVersion();
}
