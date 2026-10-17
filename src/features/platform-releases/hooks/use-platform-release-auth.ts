"use client";

import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { createBrowserSessionAdapter } from "@/lib/credentials/browser";

export function usePlatformReleaseAuth(initialUserId = "") {
  const lastAccount = useRef(initialUserId);
  const [busy, setBusy] = useState(false);
  const [signedOut, setSignedOut] = useState(false);
  useEffect(() => {
    const sessions = createBrowserSessionAdapter();
    const unsubscribe = sessions.subscribe(session => {
      const replaced = Boolean(lastAccount.current && session?.userId && lastAccount.current !== session.userId);
      // Clear the old SSR document before navigation can begin or a delayed response arrives.
      flushSync(() => setSignedOut(!session || replaced));
      if (replaced) { window.location.reload(); return; }
      if (session?.userId) lastAccount.current = session.userId;
    });
    sessions.refresh().catch(() => undefined);
    return unsubscribe;
  }, []);

  const signOut = async () => {
    setSignedOut(true);
    setBusy(true);
    const success = await createBrowserSessionAdapter().logout();
    setBusy(false);
    if (success) window.location.assign("/");
  };

  return { busy, signOut, signedOut };
}
