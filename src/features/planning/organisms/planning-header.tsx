"use client";

import { RefreshCw, X } from "lucide-react";
import { useRouter } from "next/navigation";
import type { PlanningAppController } from "@/features/planning/hooks/use-planning-app-controller";
import { ApplicationHeader } from "@/features/application-shell/organisms/application-header";
import { ApplicationWorkspaceContextOutlet, useApplicationWorkspaceContextAvailable } from "@/features/application-shell/molecules/application-workspace-context";
import { PlanningContextControls } from "@/features/planning/molecules/planning-context-controls";
import { TestProfileBanner } from "@/features/planning/molecules/test-profile-banner";
import { workspaceDescriptions, workspaceLabels } from "@/features/planning/model/planning-app-model";
import { testProfilePersona, testProfilePersonas } from "@/features/planning/model/test-profile-personas";
import { projectGitHubSyncQueue } from "@/features/tasks/model/github-sync-queue";
import { isLocalLoginSimulationEnabled } from "@/lib/local-development-auth";
import type { AdministratorAccessController } from "@/features/administrator-access/hooks/use-administrator-access-controller";
import { AdministratorModeIndicator } from "@/features/administrator-access/molecules/administrator-mode-indicator";

export function PlanningHeader({ controller, administratorAccessController }: { controller: PlanningAppController; administratorAccessController: AdministratorAccessController }) {
  const router = useRouter();
  const workspaceContextAvailable = useApplicationWorkspaceContextAvailable();
  const {
    authAvailable, authBusy, authNotice, authUser, data, devProfileId, devRoleSwitchAvailable,
    focusModeActive, githubConnectionState, githubInstallationAvailable,
    githubSyncQueueOpen, mobileNavOpen,
    planningRemoteChangesAvailable, planningRemoteChangesRefreshing, refreshPlanningRemoteChanges,
    saveError, setDevProfileId, setGithubSyncQueueOpen, setMobileNavOpen,
    setStatusGuardNotice, setStatusGuardTaskId, signIn, signOut,
    statusGuardNotice, toggleFocusMode, workspace,
  } = controller;
  const githubSyncQueue = projectGitHubSyncQueue(data.tasks, data.taskComments);
  const availableTestProfiles = devRoleSwitchAvailable ? testProfilePersonas(data.profiles, devProfileId) : [];
  const activeTestProfile = devProfileId ? data.profiles.find(profile => profile.id === devProfileId) || null : null;
  const activeTestPersona = activeTestProfile ? testProfilePersona(activeTestProfile) : null;
  const openAccountMenu = () => window.dispatchEvent(new Event("fmd:open-account-menu"));
  const administratorModeActive = administratorAccessController.administratorAccess.active;
  const administratorModeIndicator = administratorModeActive ? <AdministratorModeIndicator busy={administratorAccessController.busy} remainingSeconds={administratorAccessController.remainingSeconds} onEnd={() => void administratorAccessController.end()} /> : null;
  const focusModeAvailable = workspace === "planning" || workspace === "backlog";

  return <>
    <ApplicationHeader
      area={{ title: workspace === "planning" ? "Planung" : workspaceLabels[workspace], description: workspaceDescriptions[workspace], supportingContext: workspace === "planning" ? `${data.project.name} · ${data.project.range}` : undefined }}
      navigation={{ mobileNavOpen, openMobileNav: () => setMobileNavOpen(true), navigate: href => router.push(href) }}
      lifecycle={{
        planningState: controller.planningState,
        enabled: Boolean(authUser) && controller.protectedDataLoaded,
        notificationsWorkspace: workspace === "notifications",
        profiles: data.profiles,
        account: authAvailable ? {
          user: authUser, busy: authBusy, onSignIn: signIn, onSignOut: signOut,
          administratorAccess: administratorAccessController.administratorAccess,
          administratorAccessBusy: administratorAccessController.busy,
          administratorRemainingSeconds: administratorAccessController.remainingSeconds,
          canOpenAdministration: administratorAccessController.authority.capabilities.manageAdministratorEligibility,
          onActivateAdministrator: () => void administratorAccessController.activate(),
          onEndAdministrator: () => void administratorAccessController.end(),
          testProfileOptions: availableTestProfiles.map(profile => ({ id: profile.profileId, initials: profile.initials, label: profile.label })),
          activeTestProfileId: devProfileId, onTestProfileChange: setDevProfileId,
        } : undefined,
        github: { count: githubSyncQueue.count, failedCount: githubSyncQueue.failedCount, installationAvailable: githubInstallationAvailable, localMode: isLocalLoginSimulationEnabled(), connectionState: githubConnectionState, open: githubSyncQueueOpen, onOpen: () => setGithubSyncQueueOpen(true) },
      }}
      focus={focusModeAvailable ? { active: focusModeActive, toggle: toggleFocusMode } : undefined}
      context={controller.filtersAvailable || controller.headerActions.length > 0 || workspaceContextAvailable ? (
        <div className="flex min-w-0 flex-wrap items-end justify-between gap-3">
          <ApplicationWorkspaceContextOutlet />
          {controller.filtersAvailable || controller.headerActions.length > 0 ? <div className={controller.filtersAvailable ? "min-w-0 w-full" : "ml-auto min-w-0 max-w-full"}><PlanningContextControls {...controller} /></div> : null}
        </div>
      ) : undefined}
      notices={(
        <>
          {administratorModeIndicator ? (
            <div className="hidden min-h-14 items-center justify-center border-b border-slate-200 bg-white px-4 py-2 min-[1200px]:flex">
              {administratorModeIndicator}
            </div>
          ) : null}
          {activeTestPersona ? (
            <div className="hidden min-[1200px]:block">
              <TestProfileBanner
                initials={activeTestPersona.initials}
                label={activeTestPersona.label}
                onOpen={openAccountMenu}
                onEnd={() => setDevProfileId("")}
              />
            </div>
          ) : null}
          {planningRemoteChangesAvailable && (
            <div role="status" className="flex items-center justify-between gap-3 border-b border-blue-200 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-800 lg:px-6">
              <span>Neue Änderungen an Planungselementen sind verfügbar.</span>
              <button
                type="button"
                disabled={planningRemoteChangesRefreshing}
                onClick={() => void refreshPlanningRemoteChanges()}
                className="inline-flex h-8 shrink-0 items-center gap-2 rounded-md border border-blue-200 bg-white px-3 text-xs font-semibold text-blue-700 hover:bg-blue-100 disabled:cursor-wait disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              >
                <RefreshCw size={14} className={planningRemoteChangesRefreshing ? "animate-spin" : undefined} aria-hidden="true" />
                {planningRemoteChangesRefreshing ? "Wird aktualisiert …" : "Aktualisieren"}
              </button>
            </div>
          )}
          {saveError && (
            <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-700 lg:px-6">
              {saveError}
            </div>
          )}
          {authNotice && (
            <div className="border-b border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-800 lg:px-6">
              {authNotice}
            </div>
          )}
          {statusGuardNotice && (
            <div className="flex items-start justify-between gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-800 lg:px-6">
              <span>{statusGuardNotice}</span>
              <button type="button" onClick={() => { setStatusGuardNotice(""); setStatusGuardTaskId(null); }} className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-amber-700 hover:bg-amber-100" aria-label="Hinweis schließen">
                <X size={14} />
              </button>
            </div>
          )}
        </>
      )}
    />
      {administratorModeIndicator ? (
        <div className="sticky top-0 z-50 flex min-h-12 items-center justify-center border-b border-slate-200 bg-white/95 px-3 py-1 backdrop-blur min-[1200px]:hidden">
          {administratorModeIndicator}
        </div>
      ) : null}
      {activeTestPersona ? (
        <div className={`sticky z-40 min-[1200px]:hidden ${administratorModeActive ? "top-12" : "top-0"}`}>
          <TestProfileBanner
            initials={activeTestPersona.initials}
            label={activeTestPersona.label}
            onOpen={openAccountMenu}
            onEnd={() => setDevProfileId("")}
          />
        </div>
      ) : null}
  </>;
}
