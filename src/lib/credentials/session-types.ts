import type { NextRequest } from "next/server";
import type { User } from "@supabase/supabase-js";
import type { AuthenticatedProfile } from "../types";
import type { SessionAuthorityContext } from "@/features/administrator-access/model/administrator-access";
import type { AuthErrorCode } from "../auth-error-contract";
import type { AppWorkspace } from "@/features/planning/model/workspace-routes";

export type SessionHttpAction = "session.proxy" | "session.login-start" | "session.login" | "session.callback" | "session.link" | "session.logout-local" | "session.local-login"
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
export type { AppWorkspace };

export type ServerPlanningAuth =
  | { ok: true; user: User; profile: AuthenticatedProfile | null; authority: SessionAuthorityContext | null }
  | { ok: false; status: number; error: string; code?: AuthErrorCode; user: User | null };


export type ServerSessionView = {
  user: { id: string; email?: string; githubLogin?: string; displayName?: string; avatarUrl?: string };
  userId: string;
  revision: string;
  /** Unix seconds, bounded by the provider session. */
  expiresAt: number;
};
