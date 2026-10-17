import type { NextRequest } from "next/server";
import type { AuthzResult } from "../authz";

export type CredentialAction =
  | "team.read"
  | "planning.contribute"
  | "governance.ceo"
  | "operations.lead"
  | "planning.correct"
  | "operations.correct"
  | "administration.technical"
  | "administration.eligibility";

export type CredentialActionInput = {
  credential: { kind: "session-request"; request: NextRequest };
  action: CredentialAction;
};

export type CredentialActionResult = AuthzResult;
