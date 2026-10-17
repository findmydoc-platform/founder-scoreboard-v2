import "server-only";
import {
  requireTeamMember, requirePlanningContributor, requireCEO, requireOperationalLead,
  requirePlanningContributorOrActiveAdministrator, requireOperationalLeadOrActiveAdministrator,
  requireActiveAdministrator, requireAdministratorEligibilityManager,
} from "../../authz";
import type { CredentialActionInput } from "../types";
import type { AuthzResult } from "../../authz";

// Expand-phase delegation only. Remove with the legacy exports in #502.
export function authorizeLegacySession(input: CredentialActionInput): Promise<AuthzResult> {
  const request = input.credential.request;
  switch (input.action) {
    case "team.read": return requireTeamMember(request);
    case "planning.contribute": return requirePlanningContributor(request);
    case "governance.ceo": return requireCEO(request);
    case "operations.lead": return requireOperationalLead(request);
    case "planning.correct": return requirePlanningContributorOrActiveAdministrator(request);
    case "operations.correct": return requireOperationalLeadOrActiveAdministrator(request);
    case "administration.technical": return requireActiveAdministrator(request);
    case "administration.eligibility": return requireAdministratorEligibilityManager(request);
    default: return Promise.resolve({ ok: false, status: 403, error: "Keine Berechtigung für diese Aktion." });
  }
}
