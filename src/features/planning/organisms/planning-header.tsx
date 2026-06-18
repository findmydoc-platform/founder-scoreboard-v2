import { Filter, Menu, MessageSquare, Plus, X } from "lucide-react";
import type { PlanningAppController } from "@/features/planning/hooks/use-planning-app-controller";
import { DevRoleSwitch } from "@/features/planning/molecules/dev-role-switch";
import { GitHubConnectionStatus } from "@/features/planning/molecules/github-connection-status";
import { viewTabs, workspaceLabels, workspaceSubtitles } from "@/features/planning/model/planning-app-model";
import { NotificationInbox } from "@/features/notifications/organisms/notification-inbox";
import { AuthControl } from "@/features/settings/organisms/auth-control";

export function PlanningHeader({ controller }: { controller: PlanningAppController }) {
  const {
    actualProfile,
    authAvailable,
    authBusy,
    authError,
    authNotice,
    authUser,
    data,
    devProfileId,
    devRoleSwitchAvailable,
    dismissNotification,
    filtersAvailable,
    githubProviderTokenAvailable,
    githubReauthFailed,
    headerPrimaryAction,
    mineOwnerName,
    mobileNavOpen,
    openNotification,
    saveError,
    setDevProfileId,
    setFeedbackDialogOpen,
    setMobileNavOpen,
    setShowFilters,
    setShowNotifications,
    setStatusGuardNotice,
    setStatusGuardTaskId,
    setView,
    showNotifications,
    signIn,
    signOut,
    statusGuardNotice,
    unreadNotifications,
    view,
    workspace,
  } = controller;

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
                : workspace === "mine"
                  ? `Fokus auf die Aufgaben von ${mineOwnerName} für die operative Steuerung.`
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
            available={githubProviderTokenAvailable}
            failed={githubReauthFailed}
            busy={authBusy}
            onReconnect={() => signIn({ githubReconnect: true, clearReconnectGuard: true })}
          />
          {authAvailable && (
            <AuthControl
              user={authUser}
              error={authError}
              busy={authBusy}
              onSignIn={signIn}
              onSignOut={signOut}
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

      {filtersAvailable && <div className="flex flex-wrap items-center gap-2 px-4 pb-3 lg:px-6">
        {viewTabs.map((tab) => {
          const Icon = tab.icon;
          const active = view === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setView(tab.id)}
              className={`inline-flex h-9 shrink-0 items-center gap-2 border-b-2 px-2 text-sm font-semibold ${
                active ? "border-blue-600 text-blue-700" : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              <Icon size={16} />
              {tab.label}
            </button>
          );
        })}
      </div>}
    </header>
  );
}
