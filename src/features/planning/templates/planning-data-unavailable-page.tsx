import { workspacePath, type AppWorkspace } from "@/features/planning/model/workspace-routes";
import { PlanningBootShell } from "@/features/planning/templates/planning-boot-shell";
import { planningDataUnavailableMessage } from "@/lib/planning-data-availability";

type PlanningDataUnavailablePageProps = {
  workspace: AppWorkspace;
  authUserEmail?: string;
};

export function PlanningDataUnavailablePage({ workspace, authUserEmail = "" }: PlanningDataUnavailablePageProps) {
  return (
    <PlanningBootShell
      workspace={workspace}
      source="supabase"
      localStateLoaded
      authAvailable
      authUserEmail={authUserEmail}
      title="Planungsdaten nicht verfügbar"
      description="FounderOps konnte die geschützten Planungsdaten nicht laden. Es werden keine lokalen Beispieldaten angezeigt."
      error={planningDataUnavailableMessage}
      retryHref={workspacePath(workspace)}
    />
  );
}
