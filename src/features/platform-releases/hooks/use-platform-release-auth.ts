"use client";

import { useEffect, useState } from "react";
import { createBrowserSessionAdapter } from "@/lib/credentials/browser";

export function usePlatformReleaseAuth() {
  const [busy, setBusy] = useState(false);
  const [signedOut, setSignedOut] = useState(false);
  useEffect(() => {
    const sessions = createBrowserSessionAdapter();
    const unsubscribe = sessions.subscribe(session => setSignedOut(!session));
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
