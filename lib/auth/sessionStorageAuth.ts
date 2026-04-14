import type { Session } from "next-auth";
import { isSessionExpired } from "@/lib/auth/authTypes";

export const AUTH_SESSION_CACHE_KEY = "wild-oasis-auth-session-cache";

export function readCachedSession(): Session | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(AUTH_SESSION_CACHE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Session;
    if (isSessionExpired(s)) {
      clearCachedSession();
      return null;
    }
    return s;
  } catch {
    return null;
  }
}

export function writeCachedSession(session: Session): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(AUTH_SESSION_CACHE_KEY, JSON.stringify(session));
  } catch {
    /* ignore quota */
  }
}

export function clearCachedSession(): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(AUTH_SESSION_CACHE_KEY);
  } catch {
    /* ignore */
  }
}
