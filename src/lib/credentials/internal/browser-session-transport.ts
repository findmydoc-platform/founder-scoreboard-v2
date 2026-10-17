import "server-only";
import { createHash } from "node:crypto";
import { isAuthRetryableFetchError, type Session } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { authOrigin } from "../../auth-redirect";
import type { ServerSessionView, SessionHttpAction } from "../session-types";
import { cookieSession } from "./cookie-client";

const metadataString = (value: unknown) => typeof value === "string" ? value : "";
const displayIdentity = (user: { id: string; email?: string; user_metadata?: Record<string, unknown> }) => ({ id: user.id, ...(user.email ? { email: user.email } : {}),
  displayName: metadataString(user.user_metadata?.full_name || user.user_metadata?.name), avatarUrl: metadataString(user.user_metadata?.avatar_url),
  ...(typeof (user.user_metadata?.user_name || user.user_metadata?.preferred_username) === "string" ? { githubLogin: String(user.user_metadata?.user_name || user.user_metadata?.preferred_username) } : {}) });
const noStore = { "Cache-Control": "private, no-cache, no-store, must-revalidate, max-age=0", Expires: "0", Pragma: "no-cache" };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: noStore });
const revision = (session: Session) => createHash("sha256").update(`${session.access_token}\0${session.refresh_token}`).digest("hex");
const retryable = (error: unknown) => isAuthRetryableFetchError(error) || Boolean(error && typeof error === "object" && "status" in error && Number(error.status) >= 500);

export function allowedSessionMutation(request: NextRequest) {
  try { return request.headers.get("origin") === authOrigin() && request.headers.get("sec-fetch-site") !== "cross-site"; }
  catch { return false; }
}

export async function browserSessionTransport(request: NextRequest, action: SessionHttpAction): Promise<Response> {
  const mutation = action !== "session.current";
  if (mutation && !allowedSessionMutation(request)) return json({ error: "Keine Berechtigung für diese Anfrage." }, 403);
  if (mutation && request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") return json({ error: "JSON-Anfrage erforderlich." }, 400);
  const body = mutation ? await request.json().catch(() => null) : null;
  const expected = body?.expected;
  if (mutation && (!expected || typeof expected.userId !== "string" || typeof expected.revision !== "string")) return json({ error: "Sitzungskontext erforderlich." }, 400);
  const context = await cookieSession(false, request);
  const complete = (response: Response) => context.complete(response);
  const client = context.client;
  if (!client) return complete(json({ session: null }, 401));
  try {
    const current = await client.auth.getSession();
    if (current.error) return complete(json({ outcome: retryable(current.error) ? "temporarily_unavailable" : "unavailable", session: null }, retryable(current.error) ? 503 : 401));
    const session = current.data.session;
    if (!session) {
      if (action === "session.logout" || action === "session.clear") { context.revoke(); return complete(json({ outcome: "cleared", session: null })); }
      return complete(json({ outcome: "unavailable", session: null }, 401));
    }
    const verified = await client.auth.getUser(session.access_token);
    if (verified.error) return complete(json({ outcome: retryable(verified.error) ? "temporarily_unavailable" : "unavailable", session: null }, retryable(verified.error) ? 503 : 401));
    if (!verified.data.user || verified.data.user.id !== session.user.id) return complete(json({ outcome: "superseded", session: null }, 409));
    const view = (): ServerSessionView => ({ user: displayIdentity(verified.data.user!),
      userId: verified.data.user!.id, revision: revision(session), expiresAt: session.expires_at || 0 });
    if (!mutation) return complete(json({ session: view() }));
    if (expected.userId !== verified.data.user.id) return complete(json({ outcome: "superseded", session: null }));
    if (expected.revision !== revision(session)) return complete(json({ outcome: "superseded", session: view() }));
    if (action === "session.recover") {
      const refreshed = await client.auth.refreshSession();
      if (refreshed.error || !refreshed.data.session) return complete(json({ outcome: retryable(refreshed.error) ? "temporarily_unavailable" : "unavailable", session: null }, retryable(refreshed.error) ? 503 : 401));
      const checked = await client.auth.getUser(refreshed.data.session.access_token);
      if (checked.error) return complete(json({ outcome: retryable(checked.error) ? "temporarily_unavailable" : "unavailable", session: null }, retryable(checked.error) ? 503 : 401));
      if (checked.data.user?.id !== expected.userId) { context.revoke(); return complete(json({ outcome: "superseded", session: null }, 409)); }
      return complete(json({ outcome: "refreshed", session: { user: displayIdentity(checked.data.user), userId: checked.data.user.id,
        revision: revision(refreshed.data.session), expiresAt: refreshed.data.session.expires_at || 0 } }));
    }
    const result = await client.auth.signOut({ scope: action === "session.logout" ? "global" : "local" });
    if (result.error) return complete(json({ outcome: retryable(result.error) ? "temporarily_unavailable" : "unavailable", session: null }, retryable(result.error) ? 503 : 401));
    context.revoke();
    return complete(json({ outcome: "cleared", session: null }));
  } catch { return complete(json({ outcome: "temporarily_unavailable", session: null }, 503)); }
}
