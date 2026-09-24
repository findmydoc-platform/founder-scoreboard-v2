export const invalidSessionBeforeEffectErrorCode = "session_invalid_before_effect" as const;
export const administratorAccessRequiredErrorCode = "administrator_access_required" as const;
export const administratorAccessExpiredErrorCode = "administrator_access_expired" as const;

export type AuthErrorCode =
  | typeof invalidSessionBeforeEffectErrorCode
  | typeof administratorAccessRequiredErrorCode
  | typeof administratorAccessExpiredErrorCode;

export function isInvalidSessionBeforeEffectBody(body: unknown) {
  if (!body || typeof body !== "object") return false;
  return "code" in body && body.code === invalidSessionBeforeEffectErrorCode;
}
