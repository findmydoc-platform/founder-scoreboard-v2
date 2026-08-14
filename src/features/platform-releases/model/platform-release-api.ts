"use client";

import { getBrowserSupabase } from "@/lib/supabase";

async function authorizationHeaders(): Promise<Record<string, string>> {
  const supabase = getBrowserSupabase();
  if (!supabase) return {};
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ? { Authorization: `Bearer ${data.session.access_token}` } : {};
}

export async function platformReleaseRequest(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  const authorization = await authorizationHeaders();
  if (!headers.has("authorization") && authorization.Authorization) {
    headers.set("Authorization", authorization.Authorization);
  }
  return fetch(path, {
    ...init,
    cache: "no-store",
    headers,
  });
}
