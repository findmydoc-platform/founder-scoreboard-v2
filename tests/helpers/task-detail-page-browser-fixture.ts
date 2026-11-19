import { taskChildProgress } from "@/features/tasks/model/task-card-presentation";
import { createBrowserSessionAdapter } from "@/lib/credentials/browser";
import { inactiveAdministratorAccess } from "@/features/administrator-access/model/administrator-access";
import { taskDetailStoryTask } from "@/features/tasks/molecules/task-detail-story-fixtures";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import { readyHeaderSlot } from "@/lib/planning-header-data";
import type { PlanningHeaderData, Profile, Task } from "@/lib/types";
import type { User } from "@supabase/supabase-js";
import type { HydratedTaskDetailModel, TaskDetailModel } from "@/features/tasks/model/task-detail-read-model";
import { mockAccountLifecycle } from "./account-lifecycle-browser-fixture";
import { releaseStoryFixture } from "@/features/platform-releases/organisms/platform-release-story-fixture";

export const itemPageUser: User & { displayName: string } = { id: "item-page-user", email: "mara@example.com", displayName: "Mara", aud: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-11-01T12:00:00Z" };
export const itemPageProfile: Profile = { id: "item-page-profile", name: "Mara", platformRole: "ceo", githubLogin: "mara", orgRole: "", weeklyCapacity: 40 };
export const itemPageHeaderData: PlanningHeaderData = {
  quickLinks: readyHeaderSlot([{ id: "guide", name: "Team guide", category: "knowledge", url: "https://example.com/guide", previewImageUrl: "" }]),
  calendarEvents: readyHeaderSlot([]),
  notifications: readyHeaderSlot({ unreadCount: 0, items: [] }),
};

export function itemPageModel(taskType: Task["taskType"] = "deliverable"): HydratedTaskDetailModel {
  return {
    revision: "item-page-r1", project: emptyPlanningShellState.project,
    item: taskDetailStoryTask({ id: "item-page-task", taskType, title: "Reliable planning", assignee: itemPageProfile.id, assigneeId: itemPageProfile.id, owner: itemPageProfile.id, problemStatement: "Keep the planning context.", description: "Strategic context", updatedAt: "2026-11-01T12:00:00Z" }),
    people: [itemPageProfile], ancestors: [], children: [], relatedItems: [], sprints: [],
    discussion: { comments: [], externalComments: [] }, blockers: [], relationships: [], activity: [], reviews: [],
  };
}

export async function mockItemPageBrowser({ administrator = false, headerData = itemPageHeaderData, detailModel = itemPageModel(), respond }: {
  administrator?: boolean;
  headerData?: PlanningHeaderData;
  detailModel?: TaskDetailModel;
  respond?: (input: RequestInfo | URL, init?: RequestInit) => Response | Promise<Response> | undefined;
} = {}) {
  const restore = mockAccountLifecycle("google", { linked: true, workspaceEmail: itemPageUser.email }, (input, init) => {
    const requestUrl = new URL(String(input), window.location.origin);
    const area = requestUrl.searchParams.get("area");
    const deadline = Date.now() + 60_000;
    const observedAt = new Date().toISOString();
    const scopedDetail = async (response: Response) => {
      if (!response.ok || !requestUrl.pathname.endsWith("/detail-data") || area !== "target" && area !== "discussion" && area !== "timeline" && area !== "children") return response;
      const body = await response.clone().json();
      if (!body.taskDetail) return response;
      const model: TaskDetailModel = body.taskDetail;
      if (model.readArea !== undefined || model.sourceRevision !== undefined || model.authorityDeadline !== undefined || body.readAuthority !== undefined) return response;
      const unavailable = (body.unavailable || []) as import("@/features/tasks/model/task-detail-read-model").TaskDetailUnavailableArea[];
      const actor = model.people.find(profile => profile.id === itemPageProfile.id) || itemPageProfile;
      const coverage = area !== "target" && !unavailable.includes(area as import("@/features/tasks/model/task-detail-read-model").TaskDetailUnavailableArea) ? { [area]: model.coverage?.[area as keyof NonNullable<TaskDetailModel["coverage"]>] || "complete" } : {};
      return Response.json({ ...body, readAuthority: { userId: itemPageUser.id, deadline }, taskDetail: {
        ...model, readArea: area, sourceRevision: `fixture-detail:${model.item.id}:${model.revision}:${area}`, observedAt, validUntil: null,
        authorityDeadline: deadline, readActor: { profileId: actor.id, platformRole: actor.platformRole }, coverage,
        children: area === "children" ? model.children : [], ...(area === "children" ? { childProgress: taskChildProgress(model.children) } : {}), relatedItems: [], blockers: [], relationships: [],
        discussion: area === "discussion" ? model.discussion : { comments: [], externalComments: [] },
        activity: area === "timeline" ? model.activity : [], reviews: area === "timeline" ? model.reviews : [],
      } });
    };
    const response = respond?.(input, init);
    if (response) return Promise.resolve(response).then(scopedDetail);
    const path = new URL(String(input), window.location.origin).pathname;
    if (path === "/api/auth/session") return Response.json({ session: { userId: itemPageUser.id, user: itemPageUser, revision: "item-page-session", expiresAt: Math.floor(Date.now() / 1000) + 3600 } });
    if (path === "/api/auth/session/logout") return Response.json({ outcome: "cleared" });
    if (path === "/api/administrator-access") return Response.json({ administratorAccess: administrator ? { eligible: true, active: true, expiresAt: new Date(Date.now() + 600_000).toISOString() } : inactiveAdministratorAccess });
    if (path === "/api/planning-header-data") return Response.json({ headerData, readAuthority: { userId: itemPageUser.id, deadline: Date.now() + 60_000 } });
    if (path === `/api/tasks/${detailModel.item.id}/detail-data`) return scopedDetail(Response.json({ taskDetail: detailModel, unavailable: [] }));
    if (path === "/api/github-app/status") return Response.json({ installation: { available: true }, user: { connected: true } });
    if (path === "/api/team-workweek/team") return Response.json({ currentWorkweeks: [], calendarWorkweeks: [], calendarCoverage: "complete", referenceDate: "2026-11-02" });
    if (path === "/api/team/platform-releases/v1/releases") return Response.json({ releases: [releaseStoryFixture()] });
    return Response.json({ error: "Unscripted local fixture request" }, { status: 503 });
  });
  await createBrowserSessionAdapter().refresh();
  return restore;
}
