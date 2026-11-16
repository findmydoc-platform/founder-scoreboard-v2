import { createBrowserPlanningState } from "@/features/planning/model/internal/browser-planning-state";
import { planningWorkspaceHydration } from "@/features/planning/model/planning-workspace-hydration";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import { emptyPlanningHeaderData } from "@/lib/planning-header-data";
import { taskDetailStoryTask } from "@/features/tasks/molecules/task-detail-story-fixtures";
import type { BrowserApiClient } from "@/lib/browser-api-client";
import type { PlanningItemCandidateQuery } from "@/features/planning-items/model/planning-item-candidates";
import type { Task } from "@/lib/types";

export const epicParentProfile = { id: "epic-parent-ceo", name: "CEO", platformRole: "ceo" as const, orgRole: "CEO", githubLogin: "", weeklyCapacity: 40 };
const epic = (id: string, title: string, status: Task["status"] = "Offen") => taskDetailStoryTask({ id, title, taskType: "epic", parentTaskId: "", status, approvalStatus: "approved", updatedAt: "2026-11-01T12:00:00Z" });
export const loadedParentEpic = epic("loaded-parent-epic", "Geladenes Epic");
export const activeDefaultEpic = epic("global-active-epic", "Global aktives Epic", "In Arbeit");
export const searchedParentEpic = epic("searched-parent-epic", "Fernes Epic");
export const storedParentEpic = epic("stored-parent-epic", "Gespeichertes Epic");
export const epicDetailInitiative = taskDetailStoryTask({ id: "epic-detail-initiative", title: "Initiative mit Parent", taskType: "initiative", parentTaskId: loadedParentEpic.id,
  updatedAt: "2026-11-01T12:00:00Z", approvalStatus: "proposed", ownerId: epicParentProfile.id });

export const storedParentDeliverable = taskDetailStoryTask({ id: "stored-parent-deliverable", title: "Gespeichertes Deliverable", taskType: "deliverable", parentTaskId: epicDetailInitiative.id, approvalStatus: "approved", updatedAt: "2026-11-01T12:00:00Z" });
export const searchedParentDeliverable = { ...storedParentDeliverable, id: "searched-parent-deliverable", title: "Fernes Deliverable", approvalStatus: "proposed" as const };
export const parentDetailSubIssue = taskDetailStoryTask({ id: "parent-detail-sub-issue", title: "Sub-Issue mit Parent", taskType: "sub_issue", parentTaskId: storedParentDeliverable.id, parentApprovalStatus: "approved", assignee: epicParentProfile.id, updatedAt: "2026-11-01T12:00:00Z" });
export const parentDetailDeliverable = { ...storedParentDeliverable, id: "parent-detail-deliverable", parentTaskId: epicDetailInitiative.id };
export const searchedParentInitiative = { ...epicDetailInitiative, id: "searched-parent-initiative", title: "Ferne Initiative", approvalStatus: "approved" as const };

export const storedRelationshipTarget = { ...loadedParentEpic, id: "stored-relationship-target", title: "Gespeicherter Beziehungskontext", assignee: "CEO" };
export const searchedRelationshipTarget = { ...storedRelationshipTarget, id: "searched-relationship-target", title: "Fernes verknüpftes Item" };

export function createEpicParentBrowserFixture({ holdDefault = false, onRead, onWrite, parentKind = "epic", detailTask, onTargetRead }: {
  parentKind?: "epic" | "initiative" | "deliverable" | "relationship"; detailTask?: Task; onTargetRead?: (id: string) => void; holdDefault?: boolean; onRead?: (query: PlanningItemCandidateQuery) => void; onWrite?: (payload: Record<string, unknown>) => void;
} = {}) {
  const epicRows = [loadedParentEpic, ...Array.from({ length: 19 }, (_, index) => epic(`epic-decoy-${index}`, `Weiteres Epic ${index + 1}`)), activeDefaultEpic, searchedParentEpic, storedParentEpic];
  const rows = parentKind === "epic" ? epicRows : parentKind === "initiative"
    ? [epicDetailInitiative, ...Array.from({ length: 20 }, (_, index) => ({ ...epicDetailInitiative, id: `initiative-choice-${index}`, title: `Weitere Initiative ${index}` })), searchedParentInitiative]
    : parentKind === "relationship" ? [loadedParentEpic, ...Array.from({ length: 20 }, (_, index) => ({ ...loadedParentEpic, id: `relation-choice-${index}`, title: `Weiteres verknüpftes Item ${index}` })), storedRelationshipTarget, searchedRelationshipTarget]
    : [storedParentDeliverable, ...Array.from({ length: 20 }, (_, index) => ({ ...storedParentDeliverable, id: `deliverable-choice-${index}`, title: `Weiteres Deliverable ${index}` })), searchedParentDeliverable];
  const selectedTask = detailTask || epicDetailInitiative;
  const data = { ...emptyPlanningShellState, profiles: [epicParentProfile], tasks: [loadedParentEpic, epicDetailInitiative, ...(detailTask ? [detailTask] : [])] };
  const allContexts = [...epicRows, ...rows, storedParentDeliverable, selectedTask];
  const ancestors = (task: Task): Task[] => { const parent = allContexts.find(item => item.id === task.parentTaskId); return parent ? [...ancestors(parent), parent] : []; };
  const deadline = Date.now() + 60_000;
  let observedAt = new Date().toISOString(), sourceRevision = "epic-parent-source";
  const userId = "epic-parent-user";
  const session = { userId, revision: "epic-parent-session", expiresAt: deadline / 1000,
    user: { id: userId, aud: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-11-01T12:00:00Z" } };
  const readAuthority = { userId, deadline }, readActor = { profileId: epicParentProfile.id, platformRole: epicParentProfile.platformRole };
  const detailModel = (selected: Task) => ({ revision: selected.updatedAt!, sourceRevision: JSON.stringify([sourceRevision, "0", null, null]),
    observedAt, validUntil: new Date(deadline).toISOString(), authorityDeadline: deadline, readActor, readArea: "target" as const, item: selected,
    project: data.project, people: data.profiles, sprints: [], ancestors: ancestors(selected), children: [], relatedItems: [], coverage: {},
    discussion: { comments: [], externalComments: [] }, blockers: [], relationships: [], activity: [], reviews: [] });
  const model = { revision: "epic-parent-source", project: data.project, items: data.tasks, people: data.profiles, sprints: [], relationships: [], preferences: [],
    coverage: { items: "partial" as const, people: "complete" as const, strategies: "partial" as const, raci: "partial" as const, links: "partial" as const } };
  const state = createBrowserPlanningState({ initialData: data, initialHeaderData: emptyPlanningHeaderData, initialCurrentProfile: epicParentProfile, initialUserId: userId,
    initialWorkspace: "planning", initialWorkspaceRead: planningWorkspaceHydration("planning", model, session, { userId, deadline }),
    initialTaskDetailRead: { itemId: selectedTask.id, model: detailModel(selectedTask), readAuthority, session } });
  let released = !holdDefault, writeSequence = 0, currentInitiative = selectedTask;
  const waiting: Array<() => void> = [];
  const scalar = (task: Task) => ({ id: task.id, title: task.title, taskType: task.taskType, ...(parentKind === "relationship" ? { assigneeLabel: task.assignee || "Nicht zugeordnet" } : {}), parentTaskId: task.parentTaskId, ...(parentKind === "deliverable" ? { parentTitle: epicDetailInitiative.title } : {}), approvalStatus: task.approvalStatus || "proposed", updatedAt: task.updatedAt! });
  const client: BrowserApiClient = {
    async requestJson<T>(input: Parameters<BrowserApiClient["requestJson"]>[0], options?: Parameters<BrowserApiClient["requestJson"]>[1]) {
      const url = new URL(String(input), "http://localhost:3000");
      if (options?.method === "PATCH" || options?.method === "POST") {
        if (options.method === "POST" && url.pathname !== "/api/tasks" || options.method === "PATCH" && url.pathname !== `/api/tasks/${selectedTask.id}`) throw new Error("Unexpected parent mutation endpoint");
        const payload = options.json as Record<string, unknown>; onWrite?.(payload);
        currentInitiative = { ...currentInitiative, ...Object.fromEntries(Object.entries(payload).filter(([key]) => key in currentInitiative)), id: options.method === "POST" ? "created-epic-initiative" : currentInitiative.id,
          updatedAt: `confirmed-parent-${++writeSequence}` } as Task;
        sourceRevision = `epic-parent-source-${writeSequence}`; observedAt = new Date().toISOString();
        return { response: new Response(null, { status: options.method === "POST" ? 201 : 200 }), body: { task: currentInitiative } as T };
      }
      if (url.pathname === "/api/planning-board-data") {
        const scope = JSON.parse(url.searchParams.get("scope") || "{}") as PlanningItemCandidateQuery;
        if (scope.view !== "candidates" || scope.kind !== parentKind) throw new Error("Epic discovery must use its explicit candidate intent");
        onRead?.(scope);
        const matching = rows.filter(row => (parentKind !== "relationship" || row.id !== scope.sourceId) && row.title.toLocaleLowerCase("de").includes(scope.query));
        const offset = scope.continuation ? 20 : 0;
        const response = () => ({ response: new Response(null), body: { readAuthority, readActor, candidates: {
          kind: parentKind, items: matching.slice(offset, offset + 20).map(scalar), total: matching.length,
          coverage: offset + 20 >= matching.length ? "complete" : "partial", continuation: offset + 20 >= matching.length ? null : "epic-parent-next",
          sourceRevision, observedAt, validUntil: new Date(deadline).toISOString(), ...(parentKind === "epic" ? { defaultCandidate: scalar(activeDefaultEpic) } : {}),
        } } as T });
        if (!released && !scope.query) return new Promise<ReturnType<typeof response>>(resolve => { waiting.push(() => resolve(response())); });
        return response();
      }
      const id = decodeURIComponent(url.pathname.split("/")[3] || "");
      if (url.pathname.endsWith("/detail-data") && url.searchParams.get("area") === "target") {
        onTargetRead?.(id);
        const selected = allContexts.find(row => row.id === id) || (id === currentInitiative.id ? currentInitiative : null);
        if (!selected) throw new Error("Unexpected selected parent identity");
        return { response: new Response(null), body: { readAuthority, taskDetail: detailModel(selected) } as T };
      }
      throw new Error("Unexpected Epic parent fixture request");
    },
    requestForm: async () => { throw new Error("Unexpected form"); }, requestBlob: async () => { throw new Error("Unexpected blob"); },
  };
  state.runtime.apiClient = client;
  return { state, data, releaseDefault() { released = true; waiting.splice(0).forEach(resolve => resolve()); } };
}
