const APPROVAL_STATUSES = new Set(["draft", "proposed", "approved", "rejected"]);
const REQUIRED_TEXT_FIELDS = ["goal", "scopeConstraints", "successCriteria"];

export function validateInitiativeContextResponse(response) {
  const initiatives = response?.context?.initiatives;
  if (!Array.isArray(initiatives)) {
    throw new Error("FounderOps context is missing the initiatives array.");
  }

  for (const initiative of initiatives) {
    if (!initiative || typeof initiative !== "object" || Array.isArray(initiative)) {
      throw new Error("FounderOps context contains an invalid initiative.");
    }
    if (!APPROVAL_STATUSES.has(initiative.approvalStatus)) {
      throw new Error("FounderOps initiative context is missing a valid approvalStatus.");
    }
    for (const field of REQUIRED_TEXT_FIELDS) {
      if (typeof initiative[field] !== "string") {
        throw new Error(`FounderOps initiative context is missing the ${field} field.`);
      }
    }
  }

  return response;
}

export function placementCandidates(response) {
  validateInitiativeContextResponse(response);
  return response.context.initiatives.filter((initiative) => initiative.approvalStatus !== "rejected");
}

