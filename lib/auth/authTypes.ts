import type { Session } from "next-auth";

export type AuthStatus =
  | { status: "loading" }
  | { status: "authenticated"; session: Session; isStale: boolean }
  | { status: "unauthenticated" };

export function isSessionExpired(session: Session): boolean {
  const exp = session.expires;
  if (!exp) return false;
  return new Date(exp).getTime() <= Date.now();
}
