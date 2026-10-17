import type { AuthErrorCode } from "../auth-error-contract";
import type { SessionAuthorityContext } from "@/features/administrator-access/model/administrator-access";
import type { AuthenticatedProfile } from "../types";

type AuthzFailure = { ok: false; status: number; error: string; code?: AuthErrorCode };

export type AuthzResult =
  | { ok: true; profile: AuthenticatedProfile | null; authority?: SessionAuthorityContext }
  | AuthzFailure;
