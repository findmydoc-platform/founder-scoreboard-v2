import type { AuthenticatedProfile, TaskStatus } from "@/lib/types";
import { taskStatuses } from "@/lib/status";
import type { PlanningWorkspaceModel } from "@/features/planning-items/model/planning-workspace-model";
import type { PlanningBoardStreamFrame } from "./planning-board-delivery";
import { normalizePlanningBoardQuery, planningBoardQueryKey, type PlanningBoardColumn } from "./planning-board-query";
import type { PlanningReadAuthority } from "./planning-server-header-read";

let sequence = 0;

// Story transports retain JSON for complete, strategic, paging and retry reads.
// Deliverable query reads expose the same incremental protocol as the public API.
export function planningBoardStoryResponse(input: RequestInfo | URL, init: RequestInit | undefined, body: {
  model: PlanningWorkspaceModel;
  readAuthority: PlanningReadAuthority;
  currentProfile: AuthenticatedProfile;
}) {
  const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
  if (!headers.get("accept")?.includes("application/x-ndjson")) return Response.json(body);
  const requested = JSON.parse(new URL(input instanceof Request ? input.url : String(input), "http://localhost:3000").searchParams.get("scope") || "{}");
  const model = body.model, query = model.query || normalizePlanningBoardQuery(requested);
  const statuses: TaskStatus[] = [...taskStatuses, "Pausiert"];
  const cardIds = model.board?.cardIds || model.items.filter(item => item.taskType === "deliverable").map(item => item.id);
  const columns = model.board?.columns || Object.fromEntries(statuses.map(column => {
    const total = model.items.filter(item => cardIds.includes(item.id) && item.status === column).length;
    return [column, { total, loaded: total, availability: "ready", completeness: "complete", continuation: null } satisfies PlanningBoardColumn];
  })) as Record<TaskStatus, PlanningBoardColumn>;
  const pending = taskStatuses.filter(column => (columns[column].total || 0) > 0);
  const readId = `story-query-${++sequence}`, source = model.scopeRevision || model.revision;
  const revision = model.queryRevision || model.board?.revision || model.revision;
  const observedAt = model.board?.observedAt || new Date().toISOString(), validUntil = model.board?.validUntil ?? null;
  const board = {
    query, queryKey: planningBoardQueryKey(query), revision, observedAt, validUntil,
    childProgressById: {}, viewerOpenSubIssueIdsByDeliverableId: {},
    workspaceRevision: { activeTaskCount: model.items.length, latestUpdatedAt: model.revision },
    ...model.board,
    metrics: { ...(model.board?.metrics || { total: cardIds.length, open: model.items.filter(item => cardIds.includes(item.id) && item.status !== "Erledigt").length, done: model.items.filter(item => cardIds.includes(item.id) && item.status === "Erledigt").length }), blocked: null },
    delivery: { id: readId, columns: pending }, cardIds: [],
    columns: Object.fromEntries(statuses.map(column => [column, {
      ...columns[column], loaded: 0, continuation: null,
      availability: columns[column].total === 0 ? "ready" : "not-loaded",
      completeness: columns[column].total === 0 ? "complete" : "partial",
    } satisfies PlanningBoardColumn])) as Record<TaskStatus, PlanningBoardColumn>,
  };
  const frames: PlanningBoardStreamFrame[] = [{ kind: "basis", readId, readAuthority: body.readAuthority, currentProfile: body.currentProfile,
    model: { ...model, query, queryRevision: revision, scopeRevision: source, items: [], relationships: [], board } }];
  for (const column of pending) {
    const ids = cardIds.filter(id => model.items.some(item => item.id === id && item.status === column));
    const included = new Set(ids);
    for (const id of included) {
      const parent = model.items.find(item => item.id === id)?.parentTaskId;
      if (parent) included.add(parent);
    }
    frames.push({ kind: "column", readId, column, scopeRevision: source, queryRevision: revision, observedAt, validUntil,
      cardIds: ids, items: model.items.filter(item => included.has(item.id)),
      relationships: model.relationships.filter(relation => included.has(relation.taskId) && included.has(relation.relatedTaskId)),
      columnState: { ...columns[column], availability: "ready" }, personalChildren: model.board?.viewerOpenSubIssueIdsByDeliverableId || {},
      taskOmittedFields: model.taskOmittedFields || [],
    });
  }
  frames.push({ kind: "end", readId });
  const encoder = new TextEncoder();
  return new Response(new ReadableStream<Uint8Array>({
    pull(controller) {
      const frame = frames.shift();
      if (frame) controller.enqueue(encoder.encode(`${JSON.stringify(frame)}\n`));
      else controller.close();
    },
    cancel() { frames.length = 0; },
  }), { headers: { "content-type": "application/x-ndjson" } });
}
