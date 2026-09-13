"use client";

import {
  isAuthRefreshDiscardedError,
  isAuthRetryableFetchError,
  type Session,
} from "@supabase/supabase-js";
import { getBrowserSupabase } from "@/lib/supabase";

export type BrowserSessionSnapshot = {
  accessToken: string;
  userId: string;
};

export type BrowserSessionRecovery =
  | { kind: "refreshed"; session: BrowserSessionSnapshot }
  | { kind: "superseded" }
  | { kind: "temporarily_unavailable" }
  | { kind: "unavailable" };

export type BrowserSessionPort = {
  current(): Promise<BrowserSessionSnapshot | null>;
  recover(rejectedSession: BrowserSessionSnapshot): Promise<BrowserSessionRecovery>;
  clearIfCurrent(expectedSession: BrowserSessionSnapshot): Promise<void>;
};

function snapshotFromSession(session: Session | null): BrowserSessionSnapshot | null {
  if (!session?.access_token || !session.user?.id) return null;
  return { accessToken: session.access_token, userId: session.user.id };
}

function isSameSession(
  currentSession: BrowserSessionSnapshot,
  expectedSession: BrowserSessionSnapshot,
) {
  return currentSession.accessToken === expectedSession.accessToken
    && currentSession.userId === expectedSession.userId;
}

export function createSupabaseBrowserSessionAdapter(): BrowserSessionPort {
  async function current() {
    const supabase = getBrowserSupabase();
    if (!supabase) return null;
    const { data } = await supabase.auth.getSession();
    return snapshotFromSession(data.session);
  }

  async function clearIfCurrent(expectedSession: BrowserSessionSnapshot) {
    const supabase = getBrowserSupabase();
    if (!supabase) return;

    try {
      const currentSession = snapshotFromSession((await supabase.auth.getSession()).data.session);
      if (!currentSession || !isSameSession(currentSession, expectedSession)) return;
      await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
    } catch {
      // Preserve local auth state when its current identity cannot be compared safely.
    }
  }

  async function recover(rejectedSession: BrowserSessionSnapshot): Promise<BrowserSessionRecovery> {
    const supabase = getBrowserSupabase();
    if (!supabase) return { kind: "unavailable" };

    try {
      const currentSession = snapshotFromSession((await supabase.auth.getSession()).data.session);
      if (currentSession && currentSession.userId !== rejectedSession.userId) {
        return { kind: "superseded" };
      }
      if (currentSession && currentSession.accessToken !== rejectedSession.accessToken) {
        return { kind: "refreshed", session: currentSession };
      }

      const refreshed = await supabase.auth.refreshSession();
      const session = snapshotFromSession(refreshed.data.session);
      if (session) {
        if (session.userId !== rejectedSession.userId) return { kind: "superseded" };
        return { kind: "refreshed", session };
      }
      if (isAuthRefreshDiscardedError(refreshed.error)) return { kind: "superseded" };
      if (isAuthRetryableFetchError(refreshed.error)) return { kind: "temporarily_unavailable" };
    } catch (error) {
      if (isAuthRefreshDiscardedError(error)) return { kind: "superseded" };
      return { kind: "temporarily_unavailable" };
    }

    await clearIfCurrent(rejectedSession);
    return { kind: "unavailable" };
  }

  return { clearIfCurrent, current, recover };
}
