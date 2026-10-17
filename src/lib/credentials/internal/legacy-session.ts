import "server-only";
import { authorizeSessionPolicy } from "./session-policy";
import type { CredentialActionInput } from "../types";
import type { AuthzResult } from "../../authz";

export async function authorizeLegacySession(input: CredentialActionInput): Promise<AuthzResult> {
  const result = await authorizeSessionPolicy(input.credential.request, input.action);
  if (!result.ok) return result;
  return { ok: true, profile: result.profile, ...("authority" in result ? { authority: result.authority } : {}) };
}
