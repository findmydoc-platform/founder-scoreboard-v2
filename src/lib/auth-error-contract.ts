export const invalidSessionBeforeEffectErrorCode = "session_invalid_before_effect" as const;
export const administratorAccessRequiredErrorCode = "administrator_access_required" as const;
export const administratorAccessExpiredErrorCode = "administrator_access_expired" as const;

export type AuthErrorCode =
  | "workspace_access_denied"
  | "workspace_access_unavailable"
  | "workspace_link_required"
  | "workspace_google_login_required"
  | typeof invalidSessionBeforeEffectErrorCode
  | typeof administratorAccessRequiredErrorCode
  | typeof administratorAccessExpiredErrorCode;

export function isInvalidSessionBeforeEffectBody(body: unknown) {
  if (!body || typeof body !== "object") return false;
  return "code" in body && body.code === invalidSessionBeforeEffectErrorCode;
}

export function workspaceTransitionTarget(body: unknown): string | null {
  if (!body || typeof body !== "object" || !("code" in body)) return null;
  if (body.code === "workspace_link_required") return "/auth/link-google";
  if (body.code === "workspace_google_login_required") return "/auth/login?provider=google";
  return null;
}
