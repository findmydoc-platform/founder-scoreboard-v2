import type { NextRequest } from "next/server";
import type { ServerPlanningAuth } from "../planning-auth-server";
import type { AppWorkspace } from "@/features/planning/model/workspace-routes";

export type SessionHttpAction = "session.proxy" | "session.login" | "session.callback" | "session.link" | "session.logout-local" | "session.local-login"
  | "session.current" | "session.recover" | "session.logout" | "session.clear";
export type SessionLifecycleInput = {
  credential: { kind: "http-request"; request: NextRequest };
  action: SessionHttpAction;
};
export type SessionCookieResponseInput = { credential: { kind: "server-cookies" }; action: "session.account-state" | "session.login-mode" };
export type SessionPlanningInput = { credential: { kind: "server-cookies" }; action: "session.planning" };
export type SessionHomeInput = { credential: { kind: "server-cookies" }; action: "session.home" };
export type SessionLinkPageInput = { credential: { kind: "server-cookies" }; action: "session.link-page" };
export type SessionLinkPageState = {
  user: { id: string } | null;
  context: { mode: string; linked: boolean; linkingEnforced: boolean; profileId: string | null } | null;
  approved: boolean;
};
export type { ServerPlanningAuth, AppWorkspace };

export type ServerSessionView = {
  user: { id: string; email?: string };
  userId: string;
  revision: string;
  /** Unix seconds, bounded by the provider session. */
  expiresAt: number;
};
