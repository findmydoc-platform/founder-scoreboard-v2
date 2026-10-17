import type { AuthenticatedProfile, PlanningHeaderData } from "../types";
import type { AuthzResult } from "./auth-types";

export type NotionDecisionLogCapability = Readonly<{
  queryPage(cursor?: string): Promise<{ ok: boolean; payload: unknown }>;
}>;
export type DecisionLogCredentialInput = {
  credential: { kind: "server-cookies" };
  action: "decision-log.read";
};
export type DecisionLogCredentialResult = Extract<AuthzResult, { ok: false }> | {
  ok: true;
  profile: Readonly<AuthenticatedProfile> | null;
  notion: NotionDecisionLogCapability | null;
  loadHeader(): Promise<PlanningHeaderData>;
};
