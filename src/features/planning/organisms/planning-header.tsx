import { Filter, GitBranch, Import, Menu, MessageSquare, Plus, X } from "lucide-react";
import type { PlanningAppController } from "@/features/planning/hooks/use-planning-app-controller";
import { DevRoleSwitch } from "@/features/planning/molecules/dev-role-switch";
import { GitHubConnectionStatus } from "@/features/planning/molecules/github-connection-status";
import { viewTabs, workspaceLabels, workspaceSubtitles } from "@/features/planning/model/planning-app-model";
import { NotificationInbox } from "@/features/notifications/organisms/notification-inbox";
import { AuthControl } from "@/features/settings/organisms/auth-control";
import { hasGitHubIssue } from "@/lib/platform";

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
    githubAppConnected,
    githubReauthFailed,
    githubSyncQueueOpen,
    headerPrimaryAction,
    importDemoSeed,
    mobileNavOpen,
    openNotification,
    saveError,
    setDevProfileId,
    setFeedbackDialogOpen,
    setFilters,
    setGithubSyncQueueOpen,
    setMobileNavOpen,
    setShowFilters,
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
    unreadNotifications,
    view,
    workspace,
  } = controller;
  const showGitHubSyncTrigger = source === "supabase" && workspace === "planning";
  const githubSyncDeliverables = data.tasks.filter((task) => task.taskType === "deliverable");
  const linkedGitHubQueue = githubSyncDeliverables.filter((task) => hasGitHubIssue(task) && task.githubSyncStatus !== "synced");
  const failedGitHubSyncs = linkedGitHubQueue.filter((task) => task.githubSyncStatus === "failed");
  const missingGitHubIssues = githubSyncDeliverables.filter((task) => !hasGitHubIssue(task));
  const githubSyncQueueCount = linkedGitHubQueue.length + missingGitHubIssues.length;

  return (
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
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
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-4 lg:items-center lg:px-6">
        <div className="flex min-w-0 max-w-full items-start gap-3">
          <button
            type="button"
            onClick={() => setMobileNavOpen(true)}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 lg:hidden"
            aria-label="Navigation öffnen"
            aria-expanded={mobileNavOpen}
          >
            <Menu size={19} />
          </button>
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{workspaceLabels[workspace]}</div>
            <h1 className="truncate text-xl font-semibold text-slate-950">{workspace === "planning" ? data.project.name : workspaceLabels[workspace]}</h1>
            <div className="mt-1 text-sm text-slate-500">
              {workspace === "planning"
                ? data.project.range
                : workspaceSubtitles[workspace]}
            </div>
          </div>
        </div>
        <div className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
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
          <NotificationInbox
            notifications={unreadNotifications}
            profiles={data.profiles}
            open={showNotifications}
            onToggle={() => setShowNotifications((value) => !value)}
            onOpen={openNotification}
            onDismiss={dismissNotification}
          />
          <GitHubConnectionStatus
            authenticated={Boolean(authUser)}
            available={githubAppConnected}
            failed={githubReauthFailed}
            busy={authBusy}
            state={githubConnectionState}
            onReconnect={() => signIn({ githubReconnect: true, clearReconnectGuard: true })}
          />
          {showGitHubSyncTrigger && (
            <button
              type="button"
              onClick={() => setGithubSyncQueueOpen(true)}
              disabled={!githubAppConnected}
              aria-expanded={githubSyncQueueOpen}
              className="inline-flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <GitBranch size={16} />
              GitHub-Sync
              {githubSyncQueueCount ? (
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${failedGitHubSyncs.length ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700"}`}>
                  {githubSyncQueueCount}
                </span>
              ) : (
                <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">aktuell</span>
              )}
            </button>
          )}
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
          <button
            type="button"
            onClick={() => setFeedbackDialogOpen(true)}
            className="inline-flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700"
          >
            <MessageSquare size={16} />
            Feedback
          </button>
          {headerPrimaryAction && (
            <button
              type="button"
              onClick={headerPrimaryAction.onClick}
              className="inline-flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700"
            >
              <Plus size={16} />
              {headerPrimaryAction.label}
            </button>
          )}
          {filtersAvailable && (
            <button
              type="button"
              onClick={() => setShowFilters((value) => !value)}
              className="inline-flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700"
            >
              <Filter size={16} />
              Filter
            </button>
          )}
        </div>
      </div>

      {filtersAvailable && (
        <div className="grid gap-2 px-4 pb-3 lg:px-6">
          <div className="grid max-w-full grid-cols-[74px_minmax(0,1fr)] items-center gap-2" data-tour-id="planning-task-scope">
            <div className="text-xs font-semibold uppercase text-slate-500">Aufgaben</div>
            <div className="flex min-w-0 flex-wrap gap-2">
              {[
                { id: "", label: "Alle" },
                { id: "mine", label: "Meine" },
              ].map((scope) => {
                const active = filters.quick === scope.id || (!scope.id && filters.quick !== "mine");
                return (
                  <button
                    key={scope.label}
                    type="button"
                    onClick={() => setFilters({ ...filters, quick: scope.id, assignee: "Alle" })}
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
      )}
    </header>
  );
}
