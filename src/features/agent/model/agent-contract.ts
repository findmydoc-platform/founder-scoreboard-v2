export type AgentScope = "read:planning" | "write:intake";

export type AgentTaskFilters = {
  assignee?: string;
  owner?: string;
  sprint?: string;
  initiative?: string;
  status?: string;
  reviewOwner?: string;
  missingEvidence?: boolean;
  blocked?: boolean;
  limit?: number;
};

export const agentScopes: AgentScope[] = ["read:planning", "write:intake"];

export function agentConstraints() {
  return {
    allowedActions: agentScopes,
    readCapabilities: ["context", "tasks"],
    writeCapabilities: ["task-intake-preview", "task-intake-commit"],
    forbiddenWrites: ["score", "scoreFinal", "reviewOwnerProfileId", "reviewStatusFinalization", "raci", "sprintConfiguration", "assigneeOverrideOutsideIntake"],
    sourceOfTruth: "FounderOps Supabase via guarded API",
    noDirectDatabaseCredentials: true,
    noAiModelInsideFounderOps: true,
  };
}
