import { taskStatuses } from "@/lib/status";
import type { PlatformRole, Task } from "@/lib/types";
import type { PlanningReadAuthority } from "@/features/planning/model/planning-server-header-read";
import type { SprintWorkspaceModel } from "./sprint-read-model";
import { DEFAULT_SPRINT_TASK_FILTERS, type SprintTaskTableFilters } from "./sprint-task-table-view-model";

export type SprintTaskScope = "selected" | "assignment";

export type SprintScopedQuery = {
  scope: SprintTaskScope;
  sprintId: string | null;
  filters: SprintTaskTableFilters;
  continuation: string | null;
};

export type SprintScopedPage = {
  scope: SprintTaskScope;
  sprintId: string | null;
  items: Task[];
  context: Task[];
  scopeTotal: number;
  unassignedTotal: number | null;
  sprintTaskCounts: Record<string, number> | null;
  assignmentTargetsByItemId: Record<string, string[]>;
  matchedTotal: number;
  continuation: string | null;
  sourceRevision: string;
  evaluatedAt: string;
  validUntil: string;
};

export type SprintScopedRead = {
  page: SprintScopedPage;
  model?: SprintWorkspaceModel;
  selectionBasis?: string;
  selected?: SprintJointSelectedOutcome;
  readAuthority: PlanningReadAuthority;
  readActor: { profileId: string; platformRole: PlatformRole };
};

export type SprintScopedResult = { status: "ready" } & SprintScopedRead
  | { status: "forbidden" | "unavailable" | "staleContinuation" | "notFound" };

export type SprintSelectedProjectionRead = {
  projection: "matches";
  sprintId: string;
  matchedIds: string[];
  matchedTotal: number;
  scopeTotal: number;
  sourceRevision: string;
  evaluatedAt: string;
  validUntil: string;
  readAuthority: PlanningReadAuthority;
  readActor: SprintScopedRead["readActor"];
};

export type SprintSelectedProjectionResult = { status: "ready"; read: SprintSelectedProjectionRead }
  | { status: "forbidden" | "unavailable" | "staleSelectionBasis" };

export type SprintJointSelectedOutcome = { status: "ready"; read: SprintSelectedProjectionRead }
  | { status: "staleSelectionBasis" | "unavailable" };

export type SprintJointRead = SprintScopedRead & { selected: SprintJointSelectedOutcome };

export function parseSprintScopedQuery(params: URLSearchParams): SprintScopedQuery | null {
  const scope = params.get("scope");
  const sprintId = params.get("sprintId");
  const continuation = params.get("continuation");
  if ((scope !== "selected" && scope !== "assignment") || (scope === "assignment" && !sprintId)
    || sprintId !== null && (!sprintId || sprintId !== sprintId.trim() || sprintId.length > 200)
    || continuation !== null && (!continuation || continuation.length > 4096 || scope === "selected")) return null;
  const filters = { ...DEFAULT_SPRINT_TASK_FILTERS };
  const allowed = {
    status: ["Alle", ...taskStatuses],
    risk: ["all", "github", "carryover", "outcome"],
    review: ["all", "not_requested", "requested", "changes_requested", "accepted", "partial"],
    score: ["all", "open", "final"],
    sort: ["priority", "title", "status", "assignee", "sprint", "score"],
    direction: ["asc", "desc"],
  };
  for (const [field, values] of Object.entries(allowed)) {
    const value = params.get(field);
    if (value === null) continue;
    if (!values.includes(value)) return null;
    Object.assign(filters, { [field]: value });
  }
  filters.query = (params.get("query") || "").trim().toLocaleLowerCase("de");
  filters.assignee = params.get("assignee") || "Alle";
  if (filters.query.length > 300 || filters.assignee.length > 200) return null;
  return { scope, sprintId, filters, continuation };
}
