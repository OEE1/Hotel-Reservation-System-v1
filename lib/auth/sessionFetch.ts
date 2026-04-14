import type { Session } from "next-auth";

export type SessionFetchResult =
  | { ok: true; session: Session | null }
  | { ok: false; kind: "unauthorized" | "network" | "http"; status?: number };

/**
 * 显式请求 /api/auth/session，区分 401、网络错误与其它 HTTP 错误（NextAuth fetchData 无法区分）。
 */
export async function fetchSessionExplicit(): Promise<SessionFetchResult> {
  try {
    const res = await fetch("/api/auth/session", {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });

    if (res.status === 401) {
      return { ok: false, kind: "unauthorized", status: 401 };
    }

    if (!res.ok) {
      return { ok: false, kind: "http", status: res.status };
    }

    const data = (await res.json()) as Session | null;
    return { ok: true, session: data };
  } catch {
    return { ok: false, kind: "network" };
  }
}
