"use client";

import { useState } from "react";
import { getBrowserSupabase } from "@/lib/supabase";

export function usePlatformReleaseAuth() {
  const [busy, setBusy] = useState(false);

  const signOut = async () => {
    const supabase = getBrowserSupabase();
    if (!supabase) return;
    setBusy(true);
    const { error } = await supabase.auth.signOut({ scope: "global" });
    setBusy(false);
    if (!error) window.location.assign("/");
  };

  return { busy, signOut };
}
