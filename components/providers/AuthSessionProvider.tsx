"use client";

import type { ReactNode } from "react";
import { SessionProvider } from "next-auth/react";
import { AuthSessionSync } from "@/lib/auth/AuthSessionSync";

export function AuthSessionProvider({ children }: { children: ReactNode }) {
  return (
    <SessionProvider refetchOnWindowFocus={false}>
      <AuthSessionSync />
      {children}
    </SessionProvider>
  );
}
