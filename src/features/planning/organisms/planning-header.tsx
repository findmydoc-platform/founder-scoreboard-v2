import { Import, Plus, X } from "lucide-react";
import type { PlanningAppController } from "@/features/planning/hooks/use-planning-app-controller";
import { AppHeader } from "@/features/planning/organisms/app-header";
import { DevRoleSwitch } from "@/features/planning/molecules/dev-role-switch";
import { PlanningHeaderDataActions } from "@/features/planning/molecules/planning-header-data-actions";
import { viewTabs, workspaceDescriptions, workspaceLabels } from "@/features/planning/model/planning-app-model";
import { AuthControl } from "@/features/settings/organisms/auth-control";
import { GitHubSyncTrigger } from "@/features/tasks/molecules/github-sync-trigger";
import { projectGitHubSyncQueue } from "@/features/tasks/model/github-sync-queue";
import { PlanningHelpMenu } from "@/features/planning/molecules/planning-help-menu";

export function PlanningHeader({ controller }: { controller: PlanningAppController }) {
  const {
    actualProfile,
    authAvailable,
    authBusy,
    authError,
    authNotice,
    authUser,
    data,
    demoSeedImportAvailable,
    demoSeedImportPending,
    devProfileId,
    devRoleSwitchAvailable,
    dismissNotification,
    filters,
    filtersAvailable,
    githubConnectionState,
    githubInstallationAvailable,
    githubSyncQueueOpen,
    headerData,
    headerActions,
    importDemoSeed,
    mobileNavOpen,
    openNotification,
    openNotificationInbox,
    saveError,
    setDevProfileId,
    setFilters,
    setGithubSyncQueueOpen,
    setMobileNavOpen,
    setShowNotifications,
    setStatusGuardNotice,
    setStatusGuardTaskId,
    setView,
    setWorkspace,
    showNotifications,
    signIn,
    signOut,
    source,
    statusGuardNotice,
    view,
    workspace,
  } = controller;
  const githubSyncQueue = projectGitHubSyncQueue(data.tasks, data.taskComments);
  const title = workspace === "planning" ? data.project.name : workspaceLabels[workspace];
  const description = workspace === "planning"
    ? `${workspaceDescriptions.planning} Zeitraum: ${data.project.range}.`
    : workspaceDescriptions[workspace];
  const actionButtons = headerActions.map((action) => (
    <button
      key={action.id}
      type="button"
      onClick={() => {
        if (!action.disabled) action.onClick();
      }}
      aria-disabled={action.disabled || undefined}
      title={action.disabledReason}
      aria-label={action.disabledReason ? `${action.label}. ${action.disabledReason}` : action.label}
      className={`inline-flex h-9 min-w-0 items-center justify-center gap-2 whitespace-nowrap rounded-md px-3 text-sm font-semibold transition ${
        action.disabled
          ? "cursor-not-allowed border border-slate-200 bg-slate-100 text-slate-400"
          : action.variant === "primary"
          ? "border border-blue-600 bg-blue-600 text-white hover:bg-blue-700"
          : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
      }`}
    >
      <Plus size={16} aria-hidden="true" />
      <span className="truncate">{action.label}</span>
    </button>
  ));

  return (
    <AppHeader
      mobileNavOpen={mobileNavOpen}
      onOpenMobileNav={() => setMobileNavOpen(true)}
      description={description}
      title={title}
      notices={(
        <>
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
      actions={(
        <>
          {devRoleSwitchAvailable && (
            <DevRoleSwitch
              profiles={data.profiles}
              actualProfile={actualProfile}
              value={devProfileId}
              onChange={setDevProfileId}
            />
          )}
          {demoSeedImportAvailable && (
            <button
              type="button"
              onClick={importDemoSeed}
              disabled={demoSeedImportPending}
              className="inline-flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-md border border-emerald-200 bg-emerald-50 px-3 text-sm font-semibold text-emerald-800 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Import size={16} />
              {demoSeedImportPending ? "Lädt..." : "Beispieldaten laden"}
            </button>
          )}
          <PlanningHeaderDataActions
            headerData={headerData}
            notificationsOpen={showNotifications}
            onToggleNotifications={() => showNotifications ? setShowNotifications(false) : openNotificationInbox()}
            onOpenNotification={openNotification}
            onDismissNotification={dismissNotification}
          />
          <PlanningHelpMenu />
          <GitHubSyncTrigger
            count={githubSyncQueue.count}
            failedCount={githubSyncQueue.failedCount}
            installationAvailable={githubInstallationAvailable}
            localMode={source === "seed"}
            connectionState={githubConnectionState}
            open={githubSyncQueueOpen}
            onOpen={() => setGithubSyncQueueOpen(true)}
          />
          {authAvailable && (
            <AuthControl
              user={authUser}
              error={authError}
              busy={authBusy}
              onSignIn={signIn}
              onSignOut={signOut}
              onOpenProfile={() => setWorkspace("profile")}
            />
          )}
        </>
      )}
    >
      {filtersAvailable && (
        <div className="grid gap-2 border-t border-slate-100 px-4 py-3 lg:px-6">
          <div className="grid gap-3 md:flex md:flex-wrap md:items-center md:justify-between">
            <div className="grid min-w-0 flex-1 gap-2">
              <div className="grid max-w-full grid-cols-[74px_minmax(0,1fr)] items-center gap-2" data-tour-id="planning-task-scope">
                <div className="text-xs font-semibold uppercase text-slate-500">Aufgaben</div>
                <div className="flex min-w-0 flex-wrap gap-2">
                  {[
                    { id: "", label: "Alle" },
                    { id: "mine", label: "Meine" },
                  ].map((scope) => {
                    const active = scope.id ? filters.quick.includes(scope.id) : !filters.quick.includes("mine");
                    return (
                      <button
                        key={scope.label}
                        type="button"
                        onClick={() => setFilters({
                          ...filters,
                          assignee: "Alle",
                          quick: scope.id
                            ? Array.from(new Set([scope.id, ...filters.quick.filter((item) => item !== "mine")]))
                            : filters.quick.filter((item) => item !== "mine"),
                        })}
                        className={`inline-flex h-8 shrink-0 items-center border-b-2 px-1 text-sm font-semibold ${
                          active ? "border-blue-600 text-blue-700" : "border-transparent text-slate-500 hover:text-slate-800"
                        }`}
                        aria-pressed={active}
                      >
                        {scope.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="grid max-w-full grid-cols-[74px_minmax(0,1fr)] items-center gap-2">
                <div className="text-xs font-semibold uppercase text-slate-500">Ansicht</div>
                <div className="flex min-w-0 flex-wrap gap-2">
                  {viewTabs.map((tab) => {
                    const Icon = tab.icon;
                    const active = view === tab.id;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setView(tab.id)}
                        className={`inline-flex h-8 shrink-0 items-center gap-2 border-b-2 px-1 text-sm font-semibold ${
                          active ? "border-blue-600 text-blue-700" : "border-transparent text-slate-500 hover:text-slate-800"
                        }`}
                      >
                        <Icon size={16} />
                        {tab.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 items-center gap-2 sm:flex sm:flex-wrap md:shrink-0 md:justify-end">
              {actionButtons}
            </div>
          </div>
        </div>
      )}
      {!filtersAvailable && headerActions.length > 0 && workspace !== "notifications" && (
        <div className="flex justify-end border-t border-slate-100 px-4 py-3 lg:px-6">
          <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap">{actionButtons}</div>
        </div>
      )}
    </AppHeader>
  );
}
