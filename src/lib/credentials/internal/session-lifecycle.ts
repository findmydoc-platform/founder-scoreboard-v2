import "server-only";
import { browserSessionTransport, allowedSessionMutation } from "./browser-session-transport";
import { cookieSession, maintainSessionProxy } from "./cookie-client";
import { GET as login } from "./lifecycle-login";
import { GET as callback } from "./lifecycle-callback";
import { POST as link } from "./lifecycle-link";
import { POST as logoutLocal } from "./lifecycle-logout-local";
import { POST as localLogin } from "./lifecycle-local-login";
import { GET as accountState } from "./lifecycle-account-state";
import { GET as loginMode } from "./lifecycle-login-mode";
import type { SessionLifecycleInput, SessionCookieResponseInput, SessionHttpAction } from "../session-types";

export async function executeSessionLifecycle(input: SessionLifecycleInput | SessionCookieResponseInput): Promise<Response> {
  if (input.credential.kind === "http-request" && input.action === "session.proxy") return maintainSessionProxy(input.credential.request);
  if (input.credential.kind === "http-request" && ["session.current", "session.recover", "session.logout", "session.clear"].includes(input.action)) return browserSessionTransport(input.credential.request, input.action as SessionHttpAction);
  if (input.credential.kind === "http-request" && ["session.link", "session.logout-local"].includes(input.action) && !allowedSessionMutation(input.credential.request)) return new Response(null, { status: 403 });
  if (input.action === "session.login-mode") return loginMode();
  const request = input.credential.kind === "http-request" ? input.credential.request : undefined;
  const context = await cookieSession(input.action === "session.login" || input.action === "session.local-login", request);
  switch (input.action) {
    case "session.login": return context.complete(await login(request!));
    case "session.callback": return context.complete(await callback(request!));
    case "session.link": return context.complete(await link(request!));
    case "session.logout-local": {
      const response = await logoutLocal(request!);
      if (response.status === 303) context.revoke();
      return context.complete(response);
    }
    case "session.local-login": return context.complete(await localLogin(request!));
    case "session.account-state": return context.complete(await accountState());
    default: return new Response(null, { status: 404 });
  }
}
