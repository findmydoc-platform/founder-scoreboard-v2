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

export function createEpicParentBrowserFixture({ holdDefault = false, onRead, onWrite }: {
  holdDefault?: boolean; onRead?: (query: PlanningItemCandidateQuery) => void; onWrite?: (payload: Record<string, unknown>) => void;
} = {}) {
  const rows = [loadedParentEpic, ...Array.from({ length: 19 }, (_, index) => epic(`epic-decoy-${index}`, `Weiteres Epic ${index + 1}`)), activeDefaultEpic, searchedParentEpic, storedParentEpic];
  const data = { ...emptyPlanningShellState, profiles: [epicParentProfile], tasks: [loadedParentEpic, epicDetailInitiative] };
  const deadline = Date.now() + 60_000;
  let observedAt = new Date().toISOString(), sourceRevision = "epic-parent-source";
  const userId = "epic-parent-user";
  const session = { userId, revision: "epic-parent-session", expiresAt: deadline / 1000,
    user: { id: userId, aud: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-11-01T12:00:00Z" } };
  const readAuthority = { userId, deadline }, readActor = { profileId: epicParentProfile.id, platformRole: epicParentProfile.platformRole };
  const detailModel = (selected: Task) => ({ revision: selected.updatedAt!, sourceRevision: JSON.stringify([sourceRevision, "0", null, null]),
    observedAt, validUntil: new Date(deadline).toISOString(), authorityDeadline: deadline, readActor, readArea: "target" as const, item: selected,
    project: data.project, people: data.profiles, sprints: [], ancestors: selected.taskType === "initiative" ? rows.filter(row => row.id === selected.parentTaskId) : [], children: [], relatedItems: [], coverage: {},
    discussion: { comments: [], externalComments: [] }, blockers: [], relationships: [], activity: [], reviews: [] });
  const model = { revision: "epic-parent-source", project: data.project, items: data.tasks, people: data.profiles, sprints: [], relationships: [], preferences: [],
    coverage: { items: "partial" as const, people: "complete" as const, strategies: "partial" as const, raci: "partial" as const, links: "partial" as const } };
  const state = createBrowserPlanningState({ initialData: data, initialHeaderData: emptyPlanningHeaderData, initialCurrentProfile: epicParentProfile, initialUserId: userId,
    initialWorkspace: "planning", initialWorkspaceRead: planningWorkspaceHydration("planning", model, session, { userId, deadline }),
    initialTaskDetailRead: { itemId: epicDetailInitiative.id, model: detailModel(epicDetailInitiative), readAuthority, session } });
  let released = !holdDefault, writeSequence = 0, currentInitiative = epicDetailInitiative;
  const waiting: Array<() => void> = [];
  const scalar = (task: Task) => ({ id: task.id, title: task.title, taskType: "epic" as const, parentTaskId: "", approvalStatus: task.approvalStatus || "proposed", updatedAt: task.updatedAt! });
  const client: BrowserApiClient = {
    async requestJson<T>(input: Parameters<BrowserApiClient["requestJson"]>[0], options?: Parameters<BrowserApiClient["requestJson"]>[1]) {
      const url = new URL(String(input), "http://localhost:3000");
      if (options?.method === "PATCH" || options?.method === "POST") {
        if (options.method === "POST" && url.pathname !== "/api/tasks" || options.method === "PATCH" && url.pathname !== `/api/tasks/${epicDetailInitiative.id}`) throw new Error("Unexpected parent mutation endpoint");
        const payload = options.json as Record<string, unknown>; onWrite?.(payload);
        currentInitiative = { ...currentInitiative, ...Object.fromEntries(Object.entries(payload).filter(([key]) => key in currentInitiative)), id: options.method === "POST" ? "created-epic-initiative" : currentInitiative.id,
          updatedAt: `confirmed-parent-${++writeSequence}` } as Task;
        sourceRevision = `epic-parent-source-${writeSequence}`; observedAt = new Date().toISOString();
        return { response: new Response(null, { status: options.method === "POST" ? 201 : 200 }), body: { task: currentInitiative } as T };
      }
      if (url.pathname === "/api/planning-board-data") {
        const scope = JSON.parse(url.searchParams.get("scope") || "{}") as PlanningItemCandidateQuery;
        if (scope.view !== "candidates" || scope.kind !== "epic") throw new Error("Epic discovery must use its explicit candidate intent");
        onRead?.(scope);
        const matching = rows.filter(row => row.title.toLocaleLowerCase("de").includes(scope.query));
        const offset = scope.continuation ? 20 : 0;
        const response = () => ({ response: new Response(null), body: { readAuthority, readActor, candidates: {
          kind: "epic", items: matching.slice(offset, offset + 20).map(scalar), total: matching.length,
          coverage: offset + 20 >= matching.length ? "complete" : "partial", continuation: offset + 20 >= matching.length ? null : "epic-parent-next",
          sourceRevision, observedAt, validUntil: new Date(deadline).toISOString(), defaultCandidate: scalar(activeDefaultEpic),
        } } as T });
        if (!released && !scope.query) return new Promise<ReturnType<typeof response>>(resolve => { waiting.push(() => resolve(response())); });
        return response();
      }
      const id = decodeURIComponent(url.pathname.split("/")[3] || "");
      if (url.pathname.endsWith("/detail-data") && url.searchParams.get("area") === "target") {
        const selected = rows.find(row => row.id === id) || (id === currentInitiative.id ? currentInitiative : null);
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
