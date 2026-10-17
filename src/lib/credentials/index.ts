import "server-only";
import { authorizeLegacySession } from "./internal/legacy-session";
import type { CredentialActionInput, CredentialActionResult } from "./types";

export type { CredentialAction, CredentialActionInput, CredentialActionResult } from "./types";

export function authorizeCredentialAction(input: CredentialActionInput): Promise<CredentialActionResult> {
  if (input.credential.kind !== "session-request") {
    return Promise.resolve({ ok: false, status: 401, error: "Anmeldung erforderlich." });
  }
  return authorizeLegacySession(input);
}
