import "server-only";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import { workspaceDataFetch } from "../../workspace-data-fetch";

type Cookie = { name: string; value: string; options?: CookieOptions };
type Jar = { getAll(): Array<{ name: string; value: string }>; set(name: string, value: string, options?: CookieOptions): unknown };
const contexts = new WeakMap<object, ReturnType<typeof createCookieContext>>();
const privateHeaders = { "Cache-Control": "private, no-cache, no-store, must-revalidate, max-age=0", Expires: "0", Pragma: "no-cache" };

function environment() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
  return url && key ? { url, key } : null;
}

function createCookieContext(jar: Jar, replace = false, request?: NextRequest) {
  const env = environment();
  const pending = new Map<string, Cookie>();
  const headers = new Headers();
  const all = () => {
    const values = new Map((jar.getAll?.() || []).map(cookie => [cookie.name, cookie.value]));
    for (const cookie of pending.values()) {
      if (cookie.options?.maxAge === 0) values.delete(cookie.name);
      else values.set(cookie.name, cookie.value);
    }
    return [...values].map(([name, value]) => ({ name, value }));
  };
  const base = env ? `sb-${new URL(env.url).hostname.split(".")[0]}-auth-token` : "sb-session-auth-token";
  const pointer = `${base}-active`;
  const existing = all().find(cookie => cookie.name === pointer)?.value;
  const generation = !replace && existing && /^[A-Za-z0-9_-]{32}$/.test(existing) ? existing
    : replace ? randomBytes(24).toString("base64url") : "legacy".padEnd(32, "0");
  const scoped = `${base}-g-${generation}`;
  const revoked = `${scoped}-revoked`;
  // Refresh never publishes an active pointer, including the first legacy request.
  // A delayed pre-migration response must not replace a newer explicit login.
  const legacy = !existing && !replace;
  const secure = request ? new URL(request.url).protocol === "https:" : process.env.NODE_ENV === "production";
  let activated = !replace;
  const put = (cookie: Cookie) => {
    pending.set(cookie.name, cookie);
    try { jar.set(cookie.name, cookie.value, cookie.options); } catch { /* Proxy owns writes when SSR cookies are immutable. */ }
  };
  const activate = () => {
    if (activated) return;
    activated = true;
    put({ name: pointer, value: generation, options: { path: "/", httpOnly: true, sameSite: "lax", secure, maxAge: 400*24*3600 } });
    // Retire previous generations without changing their revocation state on refresh.
    if (replace) for (const cookie of all()) if (cookie.name.startsWith(`${base}-g-`) && !cookie.name.startsWith(scoped)) {
      put({ name: cookie.name, value: "", options: { path: "/", maxAge: 0, httpOnly: true, sameSite: "lax", secure } });
    }
  };
  // Adopt existing cookies once into HttpOnly storage. Legacy refreshes never set a pointer.
  if (legacy) {
    const previous = all();
    const scopedPresent = previous.some(cookie => cookie.name === scoped || cookie.name.startsWith(`${scoped}.`));
    for (const cookie of previous) if (cookie.name === base || cookie.name.startsWith(`${base}.`) || cookie.name.startsWith(`${base}-code-verifier`)) {
      if (!scopedPresent) put({ name: scoped + cookie.name.slice(base.length), value: cookie.value,
        options: { path: "/", httpOnly: true, sameSite: "lax", secure, maxAge: 400*24*3600 } });
      put({ name: cookie.name, value: "", options: { path: "/", maxAge: 0, httpOnly: true, sameSite: "lax", secure } });
    }
  }
  const client = env ? createServerClient(env.url, env.key, {
    cookieOptions: { name: scoped },
    global: { fetch: workspaceDataFetch },
    auth: { persistSession: true, autoRefreshToken: false, detectSessionInUrl: false, flowType: "pkce" },
    cookies: {
      getAll() {
        if (all().some(cookie => cookie.name === revoked && cookie.value === "1")) return [];
        return all();
      },
      setAll(changes, cacheHeaders) {
        activate();
        for (const cookie of changes) {
          put({ ...cookie, options: { ...cookie.options, httpOnly: true, secure } });
        }
        Object.entries(cacheHeaders || privateHeaders).forEach(([name, value]) => headers.set(name, value));
      },
    },
  }) : null;
  return {
    client,
    revoke() {
      put({ name: revoked, value: "1", options: { path: "/", httpOnly: true, secure, sameSite: "lax", maxAge: 400*24*3600 } });
    },
    complete<T extends Response>(response: T): T {
      for (const [name, value] of headers) response.headers.set(name, value);
      if (pending.size) Object.entries(privateHeaders).forEach(([name, value]) => response.headers.set(name, value));
      const target = response as T & { cookies?: NextResponse["cookies"] };
      if (target.cookies) for (const cookie of pending.values()) target.cookies.set(cookie.name, cookie.value, cookie.options);
      return response;
    },
  };
}

export async function cookieSession(replace = false, request?: NextRequest) {
  const jar = await cookies();
  let context = contexts.get(jar);
  if (!context || replace) { context = createCookieContext(jar, replace, request); contexts.set(jar, context); }
  return context;
}

// Legacy acquisition remains restricted to enumerated callers until #502.
export async function getServerAuthSupabase() { return (await cookieSession()).client; }

export async function maintainSessionProxy(request: NextRequest) {
  const context = createCookieContext({ getAll: () => request.cookies.getAll(), set: (name, value) => request.cookies.set(name, value) }, false, request);
  if (context.client) await context.client.auth.getUser();
  // Construct after the awaited SDK call so downstream request cookies and returned cookies agree.
  return context.complete(NextResponse.next({ request }));
}
