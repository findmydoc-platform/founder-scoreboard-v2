import { isValidElement, type ComponentProps, type ReactElement } from "react";
import { expect, test, vi } from "vitest";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import { emptyPlanningHeaderData } from "@/lib/planning-header-data";
import { taskDetailStoryTask } from "@/features/tasks/molecules/task-detail-story-fixtures";

const ports = vi.hoisted(() => ({ authorize: vi.fn(), after: [] as Array<() => void> }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/credentials", () => ({ authorizeCredentialAction: ports.authorize }));
vi.mock("@/lib/supabase-configuration", () => ({ requiresSupabaseAuth: () => true }));
vi.mock("next/server", () => ({ after: (callback: () => void) => ports.after.push(callback) }));
vi.mock("@/features/planning/PlanningApp", () => ({ PlanningApp: () => null }));
vi.mock("@/features/tasks/templates/task-detail-page", () => ({ TaskDetailPage: () => null }));
import TaskPage from "@/app/tasks/[id]/page";
import { TaskDetailPage } from "@/features/tasks/templates/task-detail-page";

test("canonical direct detail is delivered while unrelated Header slots remain pending under the original read", async () => {
  const session = { userId: "direct-user", revision: "direct-session", expiresAt: 3_500_000_000, user: { id: "direct-user" } };
  const authority = { userId: session.userId, deadline: 3_000_000_000_000 };
  const profile = { id: "direct-profile", name: "Synthetic reader", platformRole: "founder" as const, githubLogin: "" };
  const task = taskDetailStoryTask({ id: "direct-target", title: "Canonical direct target", ownerId: profile.id });
  const model = { revision: task.updatedAt || "target-version", sourceRevision: "target-source", readArea: "target" as const,
    readActor: { profileId: profile.id, platformRole: profile.platformRole }, authorityDeadline: authority.deadline, observedAt: "2026-11-15T12:00:00Z", validUntil: null,
    item: task, project: emptyPlanningShellState.project, ancestors: [], children: [], relatedItems: [], people: [], sprints: [], coverage: {},
    discussion: { comments: [], externalComments: [] }, blockers: [], relationships: [], activity: [], reviews: [] };
  const headerRead = { ...authority, id: "direct-header", sessionRevision: session.revision, timeoutAt: authority.deadline };
  let release!: () => void, entered!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const legacyHeaderStarted = new Promise<void>(resolve => { entered = resolve; });
  const slots = { quickLinks: held.then(() => ({ headerData: emptyPlanningHeaderData })), calendarEvents: held.then(() => ({ headerData: emptyPlanningHeaderData })) };
  const observed: { signal?: AbortSignal } = {};
  ports.authorize.mockImplementation(async ({ action }: { action: string }) => action === "session.planning" ? { ok: true, user: session.user, profile } : {
    ok: true, profile, readAuthority: authority, readSession: session, serverHeaderRead: headerRead,
    planning: {
      loadDetail: async (options: { signal?: AbortSignal }) => { observed.signal = options?.signal; return { status: "ready", model }; },
      loadHeader: async () => { entered(); await held; return { ok: true, headerData: emptyPlanningHeaderData }; },
      startServerHeaderSlots: () => slots,
    },
  });
  const pending = TaskPage({ params: Promise.resolve({ id: task.id }), searchParams: Promise.resolve({}) });
  try {
    const first = await Promise.race([pending.then(page => ({ kind: "target" as const, page })), legacyHeaderStarted.then(() => ({ kind: "header" as const }))]);
    expect(first.kind).toBe("target");
    if (first.kind !== "target" || !isValidElement(first.page)) throw new Error("Canonical detail waited for unrelated Header work");
    const page = first.page as ReactElement<ComponentProps<typeof TaskDetailPage>>;
    expect(page.props.initialModel.item.id).toBe(task.id);
    expect(page.props.initialTaskDetailRead).toMatchObject({ itemId: task.id, readAuthority: authority, session });
    expect((page.props as ComponentProps<typeof TaskDetailPage> & { initialServerHeaderRead?: typeof headerRead }).initialServerHeaderRead).toEqual(headerRead);
    expect(observed.signal?.aborted).toBe(false);
    ports.after.splice(0).forEach(callback => callback());
    expect(observed.signal?.aborted).toBe(true);
  } finally { release(); await pending; ports.after.splice(0); }
});
