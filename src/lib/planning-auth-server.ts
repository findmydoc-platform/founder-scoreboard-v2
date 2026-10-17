import type { User } from "@supabase/supabase-js";
import type { AuthenticatedProfile } from "./types";
import type { SessionAuthorityContext } from "@/features/administrator-access/model/administrator-access";
import type { AuthErrorCode } from "./auth-error-contract";
import { authorizeCredentialAction } from "./credentials";

export type ServerPlanningAuth =
  | { ok: true; user: User; profile: AuthenticatedProfile | null; authority: SessionAuthorityContext | null }
  | { ok: false; status: number; error: string; code?: AuthErrorCode; user: User | null };


export function getServerPlanningAuth() {
  return authorizeCredentialAction({ credential: { kind: "server-cookies" }, action: "session.planning" });
}

export function getServerPlanningHomeWorkspace() {
  return authorizeCredentialAction({ credential: { kind: "server-cookies" }, action: "session.home" });
}
