import { PlanningApp } from "@/features/planning/PlanningApp";
import type { AppWorkspace } from "@/features/planning/model/workspace-routes";
import { emptyPlanningData, getPlanningData } from "@/lib/planning-data";
import { getServerPlanningAuth } from "@/lib/planning-auth-server";
import type { PlanningDataQueryScope } from "@/lib/planning-data-loader";
import { isDemoSeedImportButtonAvailable } from "@/lib/seed/demo-import";
import { hasSupabaseEnv, requiresSupabaseAuth } from "@/lib/supabase";

const baseWorkspaceDataScope = {
  sprintCommitments: false,
  founderSprintScores: false,
  founderStrikeStates: false,
  strikeEvents: false,
  scoreObjections: false,
  taskComments: false,
  taskExternalComments: false,
  taskBlockers: false,
  taskActivity: false,
  taskFocusItems: false,
  notificationDeliveries: false,
  notificationPreferences: false,
  feedbackItems: false,
  fmdTools: false,
  events: false,
  meetings: false,
  meetingAttendance: false,
  audit: false,
} satisfies PlanningDataQueryScope;

const taskWorkspaceDataScope = {
  ...baseWorkspaceDataScope,
  taskComments: true,
  taskExternalComments: true,
  taskBlockers: true,
  taskActivity: true,
  taskFocusItems: true,
} satisfies PlanningDataQueryScope;

const workspaceDataScopes = {
  planning: taskWorkspaceDataScope,
  execution: taskWorkspaceDataScope,
  reviews: baseWorkspaceDataScope,
  events: { ...baseWorkspaceDataScope, events: true },
  sprint: {
    ...baseWorkspaceDataScope,
    sprintCommitments: true,
    founderSprintScores: true,
    founderStrikeStates: true,
    strikeEvents: true,
    scoreObjections: true,
    meetings: true,
    meetingAttendance: true,
  },
  projects: baseWorkspaceDataScope,
  tools: { ...baseWorkspaceDataScope, fmdTools: true },
  team: baseWorkspaceDataScope,
  settings: {
    ...baseWorkspaceDataScope,
    notificationDeliveries: true,
    feedbackItems: true,
  },
  "ceo-intake": baseWorkspaceDataScope,
  profile: {
    ...baseWorkspaceDataScope,
    notificationPreferences: true,
  },
} satisfies Record<AppWorkspace, PlanningDataQueryScope>;

function loadWorkspacePlanningData(initialWorkspace: AppWorkspace) {
  return getPlanningData(workspaceDataScopes[initialWorkspace]);
}

export async function renderWorkspacePage(initialWorkspace: AppWorkspace) {
  if (hasSupabaseEnv() && requiresSupabaseAuth()) {
    const auth = await getServerPlanningAuth(["ceo", "founder", "deputy", "viewer"]);
    if (!auth.ok) {
      return (
        <PlanningApp
          initialData={emptyPlanningData}
          initialWorkspace={initialWorkspace}
          source="supabase"
          authRequired
          initialAuthUser={auth.user}
          initialAuthError={auth.error}
        />
      );
    }

    const { data, source } = await loadWorkspacePlanningData(initialWorkspace);
    return (
      <PlanningApp
        initialData={data}
        initialWorkspace={initialWorkspace}
        source={source}
        authRequired
        demoSeedImportAvailable={source === "seed" && isDemoSeedImportButtonAvailable()}
        initialAuthUser={auth.user}
        initialCurrentProfile={auth.profile}
        initialProtectedDataLoaded
      />
    );
  }

  const { data, source } = await loadWorkspacePlanningData(initialWorkspace);
  return (
    <PlanningApp
      initialData={data}
      initialWorkspace={initialWorkspace}
      source={source}
      authRequired={false}
      demoSeedImportAvailable={source === "seed" && isDemoSeedImportButtonAvailable()}
    />
  );
}
