import { notFound } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { PlanningApp } from "@/features/planning/PlanningApp";
import { WorkspaceDataUnavailablePage } from "@/features/planning/templates/workspace-data-unavailable-page";
import { TaskDetailPage } from "@/features/tasks/templates/task-detail-page";
import { safeTaskDetailReturnTo } from "@/features/tasks/model/task-detail-return-navigation";
import { PlanningTrashTaskDetailPage } from "@/features/planning-trash/templates/planning-trash-task-detail-page";
import { taskDetailDegradationMessage } from "@/features/tasks/model/task-detail-planning-shell-projection";
import { parseTaskCommentTarget } from "@/features/tasks/model/task-comment-target";
import { authorizeCredentialAction } from "@/lib/credentials";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import { emptyPlanningHeaderData } from "@/lib/planning-header-data";
import { getServerPlanningAuth } from "@/lib/planning-auth-server";
import { redirectForWorkspaceGate } from "@/lib/workspace-gate-redirect";
import { requiresSupabaseAuth } from "@/lib/supabase";
import type { AuthenticatedProfile } from "@/lib/types";
import type { AdministratorAccessSnapshot } from "@/features/administrator-access/model/administrator-access";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ returnTo?: string | string[]; comment?: string | string[]; focus?: string | string[] }>;
};

export default async function TaskPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { returnTo, comment, focus } = await searchParams;
  const safeReturnTo = safeTaskDetailReturnTo(returnTo);
  const requestedCommentTarget = parseTaskCommentTarget(focus) || parseTaskCommentTarget(comment);
  let authProfile: AuthenticatedProfile | null = null;
  let authUser: User | null = null;
  let administratorAccess: AdministratorAccessSnapshot | undefined;
  const authRequired = requiresSupabaseAuth();
  if (authRequired) {
    const auth = await getServerPlanningAuth();
    if (!auth.ok) {
      redirectForWorkspaceGate(auth.code);
      return <PlanningApp initialData={emptyPlanningShellState} initialHeaderData={emptyPlanningHeaderData} initialWorkspace="planning" source="supabase" authRequired initialAuthUser={auth.user} initialAuthError={auth.error} />;
    }
    authProfile = auth.profile;
    authUser = auth.user;
    administratorAccess = auth.authority?.administratorAccess;
  }

  const permission = await authorizeCredentialAction({ credential: { kind: "server-cookies" }, action: "planning.task.read", targetId: id });
  if (!permission.ok) return <WorkspaceDataUnavailablePage workspace="planning" />;
  const [taskDetailResult, header] = await Promise.all([permission.planning.loadDetail(), permission.planning.loadHeader()]);
  if (!header.ok) return <WorkspaceDataUnavailablePage workspace="planning" />;
  const headerData = header.headerData;
  if (taskDetailResult.status === "unavailable" || taskDetailResult.status === "forbidden") {
    return <WorkspaceDataUnavailablePage workspace="planning" />;
  }

  if (taskDetailResult.status === "notFound") {
    const trashDetailResult = await permission.planning.loadTrashDetail();
    if (!trashDetailResult.ok) {
      if (trashDetailResult.status === 404) notFound();
      return <WorkspaceDataUnavailablePage workspace="planning" />;
    }
    return (
      <PlanningTrashTaskDetailPage
        detail={trashDetailResult.detail}
        profiles={[...taskDetailResult.people]}
        currentPlatformRole={authProfile?.platformRole}
      />
    );
  }

  return (
    <TaskDetailPage
      taskId={taskDetailResult.model.item.id}
      initialModel={taskDetailResult.model}
      headerData={headerData}
      source="supabase"
      authRequired={authRequired}
      initialAuthUser={authUser}
      initialCurrentProfile={authProfile}
      initialAdministratorAccess={administratorAccess}
      initialDetailDataError={taskDetailResult.status === "degraded"
        ? taskDetailDegradationMessage(taskDetailResult.unavailable)
        : ""}
      initialCommentTarget={requestedCommentTarget}
      returnHref={safeReturnTo || "/planning"}
      returnLabel={safeReturnTo ? "Zurück zum Release" : "Zur Planung"}
    />
  );
}
