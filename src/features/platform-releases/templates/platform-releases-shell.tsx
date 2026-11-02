"use client";

import type { User } from "@supabase/supabase-js";
import { useEffect, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { usePlatformReleaseAuth } from "@/features/platform-releases/hooks/use-platform-release-auth";
import { ApplicationHeader } from "@/features/application-shell/organisms/application-header";
import { AppSidebar } from "@/features/planning/organisms/app-sidebar";
import { usePlanningStateOwner } from "@/features/planning/hooks/use-planning-state-owner";
import { PlanningBusinessStateContext } from "@/features/planning/hooks/use-planning-business-state";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import { projectGitHubSyncQueue } from "@/features/tasks/model/github-sync-queue";
import { useTaskGitHubSyncCommand } from "@/features/tasks/hooks/use-task-github-sync-command";
import { TaskGitHubSyncQueue } from "@/features/tasks/organisms/task-github-sync-queue";
import { isLocalLoginSimulationEnabled } from "@/lib/local-development-auth";
import { useAdministratorAccessController } from "@/features/administrator-access/hooks/use-administrator-access-controller";
import type { AdministratorAccessSnapshot } from "@/features/administrator-access/model/administrator-access";
import type { AuthenticatedProfile, HeaderDataSlot, PlanningHeaderData, PlatformRole, Profile } from "@/lib/types";

type Props = {
  authUser?: User | null;
  children: ReactNode;
  currentPlatformRole?: PlatformRole;
  initialCurrentProfile?: AuthenticatedProfile | null;
  initialAdministratorAccess?: AdministratorAccessSnapshot;
  headerData: PlanningHeaderData;
  calendarProfiles?: HeaderDataSlot<Profile[]>;
  returnToArchive?: boolean;
};

export function PlatformReleasesShell({ authUser = null, children, currentPlatformRole, initialCurrentProfile = null, initialAdministratorAccess, headerData, calendarProfiles, returnToArchive = false }: Props) {
  const owner = usePlanningStateOwner({ initialData: { ...emptyPlanningShellState, profiles: calendarProfiles?.state === "ready" ? calendarProfiles.data : [] }, initialHeaderData: headerData, initialCurrentProfile, initialAdministratorAccess, initialUserId: authUser?.id || "", initialWorkspace: "decision-log" });
  const { planningState, data } = owner;
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [githubOpen, setGithubOpen] = useState(false);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const { busy: authBusy, reconnectGitHub, signOut, signedOut } = usePlatformReleaseAuth(authUser?.id);
  const administrator = useAdministratorAccessController({ initialAccess: initialAdministratorAccess, platformRole: initialCurrentProfile?.platformRole || currentPlatformRole });
  const protectedUnavailable = signedOut || planningState.protectedCache() === null;
  const enabled = Boolean(authUser) && !protectedUnavailable;
  const githubConnection = planningState.githubConnection();
  const queue = projectGitHubSyncQueue(data.tasks, data.taskComments);
  const commands = useTaskGitHubSyncCommand({ planningState, setSaveError: setError, startTransition });
  useEffect(() => {
    if (enabled && !isLocalLoginSimulationEnabled()) void planningState.loadGitHubConnection();
  }, [enabled, planningState]);
  const navigate = (href: string) => { setMobileOpen(false); router.push(href); };
  return (
    <PlanningBusinessStateContext.Provider value={planningState}><div className="min-h-screen bg-white text-slate-950">
      {!protectedUnavailable ? <AppSidebar
        activeWorkspace="platform-releases"
        currentPlatformRole={currentPlatformRole}
        canAccessAdministration={administrator.authority.capabilities.manageAdministratorEligibility}
        mobileOpen={mobileOpen}
        onMobileClose={() => setMobileOpen(false)}
      /> : null}
      <main className="app-sidebar-main min-w-0">
        <ApplicationHeader
          area={{ title: "Releases", heading: !returnToArchive, description: "Auslieferungen einzelner Anwendungen und der gemeinsamen Plattform." }}
          context={returnToArchive && enabled ? <Link href="/team/platform-releases" className="inline-flex min-h-11 items-center gap-2 rounded-md text-sm font-semibold text-blue-700 hover:underline focus-visible:outline-2 focus-visible:outline-blue-500"><ArrowLeft size={16} aria-hidden="true" />Zurück zu Releases</Link> : undefined}
          navigation={{ mobileNavOpen: mobileOpen, openMobileNav: () => setMobileOpen(true), navigate }}
          lifecycle={{
            planningState, enabled, profiles: data.profiles, calendarProfiles: enabled ? calendarProfiles : undefined,
            account: enabled ? {
              user: authUser!, busy: authBusy, onSignIn: () => undefined, onSignOut: () => void signOut(),
              administratorAccess: administrator.administratorAccess, administratorAccessBusy: administrator.busy,
              administratorRemainingSeconds: administrator.remainingSeconds,
              canOpenAdministration: administrator.authority.capabilities.manageAdministratorEligibility,
              onActivateAdministrator: () => void administrator.activate(), onEndAdministrator: () => void administrator.end(),
            } : undefined,
            github: { count: queue.count, failedCount: queue.failedCount, installationAvailable: githubConnection.installationAvailable, connectionState: githubConnection.readStatus === "loading" ? "checking" : githubConnection.state, localMode: isLocalLoginSimulationEnabled(), open: githubOpen, onOpen: () => { setGithubOpen(true); if (enabled && !isLocalLoginSimulationEnabled()) void planningState.loadGitHubConnection(); } },
          }}
        />
        {enabled && administrator.message ? <p role="status" className="px-6 py-3 text-sm text-red-700">{administrator.message}</p> : null}
        {protectedUnavailable ? <p role="status" className="p-6">Die Sitzung ist beendet. Der Zugriff auf die Releases ist gesperrt.</p> : children}
      </main>
      {enabled ? <TaskGitHubSyncQueue
        open={githubOpen} tasks={data.tasks} comments={data.taskComments} pending={pending}
        githubInstallationAvailable={githubConnection.installationAvailable} githubUserConnected={githubConnection.userConnected}
        githubConnectionState={githubConnection.readStatus === "loading" ? "checking" : githubConnection.state}
        waitingGitHubCommentCount={githubConnection.waitingCommentCount} githubReauthFailed={githubConnection.state === "reconnect_required"}
        authBusy={authBusy} localMode={isLocalLoginSimulationEnabled()} notice={error || commands.githubSyncNotice}
        onClose={() => setGithubOpen(false)} onOpenTask={id => { setGithubOpen(false); navigate(`/tasks/${encodeURIComponent(id)}`); }}
        onReconnect={reconnectGitHub}
        onSyncLinkedGitHubTasks={commands.syncLinkedGitHubTasks} onSyncTaskToGitHub={commands.syncTaskToGitHub}
        syncOperations={planningState.taskGitHubSyncs()} onCheckSync={id => { void planningState.checkTaskGitHubSync(id); }}
      /> : null}
    </div></PlanningBusinessStateContext.Provider>
  );
}
