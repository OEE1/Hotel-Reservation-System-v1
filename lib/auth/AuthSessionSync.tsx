"use client";

import { getSession, useSession } from "next-auth/react";
import type { Session } from "next-auth";
import { useEffect, useRef } from "react";
import { isSessionExpired } from "@/lib/auth/authTypes";
import {
  clearCachedSession,
  readCachedSession,
  writeCachedSession,
} from "@/lib/auth/sessionStorageAuth";
import { fetchSessionExplicit } from "@/lib/auth/sessionFetch";
import {
  resetAuthToUnauthenticated,
  setAuthAuthenticated,
  setAuthLoading,
} from "@/store/authSessionStore";

const RETRY_DELAYS_MS = [2000, 4000, 8000];
const STALE_TTL_MS = 5 * 60 * 1000;

/**
 * 将 NextAuth useSession 与显式 /api/auth/session 拉取对齐到 authSessionStore。
 */
export function AuthSessionSync() {
  const { data, status } = useSession();
  const backoffAbortRef = useRef<AbortController | null>(null);
  const ttlRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const staleRefreshStartedRef = useRef(false);
  const noCacheProbeDoneRef = useRef(false);

  useEffect(() => {
    return () => {
      backoffAbortRef.current?.abort();
      if (ttlRef.current) clearTimeout(ttlRef.current);
    };
  }, []);

  /** 恢复网络后允许再次探测 session，并触发 NextAuth 拉取 */
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onOnline = () => {
      noCacheProbeDoneRef.current = false;
      void getSession();
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, []);

  useEffect(() => {
    if (status === "loading") {
      setAuthLoading();
      noCacheProbeDoneRef.current = false;
      return;
    }

    if (status === "authenticated" && data) {
      staleRefreshStartedRef.current = false;
      noCacheProbeDoneRef.current = false;
      backoffAbortRef.current?.abort();
      if (ttlRef.current) {
        clearTimeout(ttlRef.current);
        ttlRef.current = null;
      }
      const s = data as Session;
      if (isSessionExpired(s)) {
        clearCachedSession();
        resetAuthToUnauthenticated();
        return;
      }
      writeCachedSession(s);
      setAuthAuthenticated(s, false);
      return;
    }

    if (status !== "unauthenticated") return;

    const cached = readCachedSession();
    if (cached && !isSessionExpired(cached)) {
      // NextAuth 在断网时可能误报 unauthenticated；只要有本地缓存就保持可会话态 + Stale
      setAuthAuthenticated(cached, true);
      if (!staleRefreshStartedRef.current) {
        staleRefreshStartedRef.current = true;
        backoffAbortRef.current?.abort();
        const ac = new AbortController();
        backoffAbortRef.current = ac;

        (async () => {
          let last = await fetchSessionExplicit();
          for (let i = 0; i < RETRY_DELAYS_MS.length; i++) {
            if (ac.signal.aborted) return;

            if (last.ok && last.session && !isSessionExpired(last.session)) {
              setAuthAuthenticated(last.session, false);
              writeCachedSession(last.session);
              if (ttlRef.current) {
                clearTimeout(ttlRef.current);
                ttlRef.current = null;
              }
              return;
            }
            if (last.ok && last.session === null) {
              clearCachedSession();
              resetAuthToUnauthenticated();
              return;
            }
            if (last.ok === false && last.kind === "unauthorized") {
              clearCachedSession();
              resetAuthToUnauthenticated();
              return;
            }

            await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[i]));
            if (ac.signal.aborted) return;
            last = await fetchSessionExplicit();
          }

          if (ac.signal.aborted) return;

          if (last.ok && last.session && !isSessionExpired(last.session)) {
            setAuthAuthenticated(last.session, false);
            writeCachedSession(last.session);
            return;
          }
          if (last.ok && last.session === null) {
            clearCachedSession();
            resetAuthToUnauthenticated();
            return;
          }
          if (last.ok === false && last.kind === "unauthorized") {
            clearCachedSession();
            resetAuthToUnauthenticated();
            return;
          }

          if (ttlRef.current) clearTimeout(ttlRef.current);
          ttlRef.current = setTimeout(() => {
            clearCachedSession();
            resetAuthToUnauthenticated();
          }, STALE_TTL_MS);
        })();
      }
      return;
    }

    staleRefreshStartedRef.current = false;

    if (!noCacheProbeDoneRef.current) {
      noCacheProbeDoneRef.current = true;
      (async () => {
        const result = await fetchSessionExplicit();
        if (result.ok) {
          if (result.session && !isSessionExpired(result.session)) {
            setAuthAuthenticated(result.session, false);
            writeCachedSession(result.session);
          } else {
            clearCachedSession();
            resetAuthToUnauthenticated();
          }
          return;
        }
        if (result.ok === false && result.kind === "unauthorized") {
          clearCachedSession();
          resetAuthToUnauthenticated();
          return;
        }
        // 网络/5xx：不能推断为未登录（可能仍持有 cookie）；保持 loading，恢复网络后由 online + getSession 再同步
        setAuthLoading();
      })();
    }
  }, [status, data]);

  return null;
}
