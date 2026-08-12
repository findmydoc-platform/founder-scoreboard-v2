import { workspacePath, type AppWorkspace } from "@/features/planning/model/workspace-routes";
import { PlanningBootShell } from "@/features/planning/templates/planning-boot-shell";
import { planningDataUnavailableMessage } from "@/lib/workspace-data-availability";

type WorkspaceDataUnavailablePageProps = {
  workspace: AppWorkspace;
  authUserEmail?: string;
};

export function WorkspaceDataUnavailablePage({ workspace, authUserEmail = "" }: WorkspaceDataUnavailablePageProps) {
  return (
    <PlanningBootShell
      workspace={workspace}
      source="supabase"
      authAvailable
      authUserEmail={authUserEmail}
      title="Planungsdaten nicht verfügbar"
      description="FounderOps konnte die geschützten Planungsdaten nicht laden. Es werden keine lokalen Beispieldaten angezeigt."
      error={planningDataUnavailableMessage}
      retryHref={workspacePath(workspace)}
    />
  );
}
