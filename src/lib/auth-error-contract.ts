export const invalidSessionBeforeEffectErrorCode = "session_invalid_before_effect" as const;

export type AuthErrorCode = typeof invalidSessionBeforeEffectErrorCode;

export function isInvalidSessionBeforeEffectBody(body: unknown) {
  if (!body || typeof body !== "object") return false;
  return "code" in body && body.code === invalidSessionBeforeEffectErrorCode;
}
