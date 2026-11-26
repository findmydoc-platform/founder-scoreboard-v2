import { beforeEach, expect, test, vi } from "vitest";
import { emptyPlanningHeaderData } from "@/lib/planning-header-data";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";

const permissions = vi.hoisted(() => ({ authorize: vi.fn(), selected: vi.fn(), legacy: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-configuration", async (original) => ({ ...await original<typeof import("@/lib/supabase-configuration")>(), requiresSupabaseAuth: () => true }));
vi.mock("@/lib/credentials", () => ({ authorizeCredentialAction: permissions.authorize }));
vi.mock("@/features/planning/PlanningApp", () => ({ PlanningApp: () => null }));

import SprintPage from "@/app/(workspaces)/sprint/page";

const profile = { id: "synthetic-sprint-profile", platformRole: "founder" };
let session: { userId: string; revision: string; expiresAt: number };

beforeEach(() => {
  vi.resetAllMocks();
  session = { userId: "synthetic-sprint-user", revision: "session-1", expiresAt: Math.floor(Date.now() / 1_000) + 3_600 };
  permissions.authorize.mockImplementation(async ({ action }) => action === "session.planning"
    ? { ok: true, profile, session, user: { id: session.userId } }
    : { ok: true, profile, readSession: session, planning: {
      loadSprintScope: permissions.selected,
      loadSprint: permissions.legacy,
      loadHeader: async () => ({ ok: true, headerData: emptyPlanningHeaderData }),
    } });
});

test("direct Sprint entry uses the URL filters in exactly one authenticated selected read", async () => {
  const { project, tasks } = emptyPlanningShellState;
  const deadline = Date.now() + 60_000;
  const page = { scope: "selected", sprintId: "sprint-2", sourceRevision: "42", items: tasks };
  permissions.selected.mockResolvedValue({
    status: "ready", page, selectionBasis: "signed-document-basis",
    model: { project, items: tasks, people: [], sprints: [], commitments: [], scores: [], strikeStates: [], strikeEvents: [],
      objections: [], meetings: [], attendance: [], coverage: {}, revision: "42" },
    readActor: { profileId: profile.id, platformRole: profile.platformRole },
    readAuthority: { userId: session.userId, deadline },
  });

  const rendered = await SprintPage({ searchParams: Promise.resolve({
    "sprintTasks.query": ["Late Task", "Not the selected query"],
    "sprintTasks.scope": "assignment",
    "sprintTasks.sprintId": "unrequested-sprint",
  }) });

  expect(permissions.selected).toHaveBeenCalledExactlyOnceWith({
    scope: "selected", sprintId: null, filters: expect.objectContaining({ query: "late task" }), continuation: null,
  });
  expect(permissions.legacy).not.toHaveBeenCalled();
  expect(rendered.props.initialWorkspaceRead).toMatchObject({
    workspace: "sprint", scopeRevision: "42", session, readAuthority: { userId: session.userId, deadline },
    sprintScope: { query: { scope: "selected", sprintId: "sprint-2" }, page, selectionBasis: "signed-document-basis" },
  });
});
