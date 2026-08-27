import { Maximize2, Minimize2, Plus, RefreshCw, SlidersHorizontal, UserRound, X } from "lucide-react";
import type { PlanningAppController } from "@/features/planning/hooks/use-planning-app-controller";
import { AppHeader } from "@/features/planning/organisms/app-header";
import { TestProfileBanner } from "@/features/planning/molecules/test-profile-banner";
import { PlanningHeaderDataActions } from "@/features/planning/molecules/planning-header-data-actions";
import { DEFAULT_PLANNING_FILTERS } from "@/features/planning/hooks/use-planning-view-state";
import { viewTabs, workspaceDescriptions, workspaceLabels } from "@/features/planning/model/planning-app-model";
import { planningLevels, type PlanningLevel } from "@/features/planning/model/planning-level";
import { testProfilePersona, testProfilePersonas } from "@/features/planning/model/test-profile-personas";
import { AuthControl } from "@/features/settings/organisms/auth-control";
import { GitHubSyncTrigger } from "@/features/tasks/molecules/github-sync-trigger";
import { projectGitHubSyncQueue } from "@/features/tasks/model/github-sync-queue";
import { PlanningHelpMenu } from "@/features/planning/molecules/planning-help-menu";
import { isLocalLoginSimulationEnabled } from "@/lib/local-development-auth";
import type { ViewMode } from "@/lib/types";
import { CustomSelect } from "@/shared/atoms/custom-select";

export function PlanningHeader({ controller }: { controller: PlanningAppController }) {
  const {
    actualProfile,
    authAvailable,
    authBusy,
    authNotice,
    authUser,
    data,
    devProfileId,
    devRoleSwitchAvailable,
    dismissNotification,
    filters,
    filtersAvailable,
    focusModeActive,
    githubConnectionState,
    githubInstallationAvailable,
    githubSyncQueueOpen,
    headerData,
    headerActions,
    mobileNavOpen,
    openNotification,
    openNotificationInbox,
    planningRemoteChangesAvailable,
    planningRemoteChangesRefreshing,
    planningLevel,
    planningParentFilterId,
    refreshPlanningRemoteChanges,
    saveError,
    setDevProfileId,
    setFilters,
    setGithubSyncQueueOpen,
    setMobileNavOpen,
    setPlanningLevel,
    setShowNotifications,
    setShowFilters,
    setStatusGuardNotice,
    setStatusGuardTaskId,
    setView,
    setWorkspace,
    showNotifications,
    showFilters,
    signIn,
    signOut,
    statusGuardNotice,
    toggleFocusMode,
    view,
    workspace,
  } = controller;
  const githubSyncQueue = projectGitHubSyncQueue(data.tasks, data.taskComments);
  const title = workspace === "planning" ? data.project.name : workspaceLabels[workspace];
  const description = workspace === "planning"
    ? `${workspaceDescriptions.planning} Zeitraum: ${data.project.range}.`
    : workspaceDescriptions[workspace];
  const availableTestProfiles = devRoleSwitchAvailable ? testProfilePersonas(data.profiles, devProfileId) : [];
  const activeTestProfile = devProfileId
    ? data.profiles.find((profile) => profile.id === devProfileId) || null
    : null;
  const activeTestPersona = activeTestProfile ? testProfilePersona(activeTestProfile) : null;
  const planningFiltersDirty = JSON.stringify(filters) !== JSON.stringify(DEFAULT_PLANNING_FILTERS)
    || planningParentFilterId !== "all";
  const mineActive = filters.quick.includes("mine");
  const openAccountMenu = () => window.dispatchEvent(new Event("fmd:open-account-menu"));
  const focusModeAvailable = workspace === "planning" || workspace === "backlog";
  const focusModeButton = focusModeAvailable ? (
    <button
      type="button"
      onClick={toggleFocusMode}
      aria-pressed={focusModeActive}
      title={focusModeActive ? "Fokusmodus beenden" : "Fokusmodus im Vollbild starten"}
      className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
    >
      {focusModeActive ? <Minimize2 size={16} aria-hidden="true" /> : <Maximize2 size={16} aria-hidden="true" />}
      <span className={focusModeActive ? "inline" : "sr-only"}>{focusModeActive ? "Fokusmodus beenden" : "Fokusmodus"}</span>
    </button>
  ) : null;
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
  const accountControl = authAvailable ? (
    <AuthControl
      user={authUser}
      busy={authBusy}
      onSignIn={signIn}
      onSignOut={signOut}
      onOpenProfile={() => setWorkspace("profile")}
      testProfileOptions={availableTestProfiles.map((profile) => ({
        id: profile.profileId,
        initials: profile.initials,
        label: profile.label,
      }))}
      activeTestProfileId={devProfileId}
      onTestProfileChange={setDevProfileId}
    />
  ) : null;

  return (
    <>
      <AppHeader
      compact={focusModeActive}
      mobileNavOpen={mobileNavOpen}
      onOpenMobileNav={() => setMobileNavOpen(true)}
      eyebrow="FounderOps"
      description={description}
      title={title}
      notices={(
        <>
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
      actions={(
        focusModeActive ? <>{focusModeButton}{accountControl}</> : <>
          {focusModeButton}
          <PlanningHeaderDataActions
            headerData={headerData}
            notificationsOpen={showNotifications}
            onToggleNotifications={() => showNotifications ? setShowNotifications(false) : openNotificationInbox()}
            onOpenNotification={openNotification}
            onDismissNotification={dismissNotification}
            calendar={{
              apiClient: actualProfile ? controller.apiClient : undefined,
              onOpenTeam: () => setWorkspace("team"),
              profiles: data.profiles,
            }}
          />
          <PlanningHelpMenu />
          <GitHubSyncTrigger
            count={githubSyncQueue.count}
            failedCount={githubSyncQueue.failedCount}
            installationAvailable={githubInstallationAvailable}
            localMode={isLocalLoginSimulationEnabled()}
            connectionState={githubConnectionState}
            open={githubSyncQueueOpen}
            onOpen={() => setGithubSyncQueueOpen(true)}
          />
          {accountControl}
        </>
      )}
    >
      {filtersAvailable && (
        <div className="hidden gap-2 border-t border-slate-100 px-8 py-3 min-[1200px]:grid">
          <div className="grid gap-3 md:flex md:flex-wrap md:items-center md:justify-between">
            <div className="grid min-w-0 flex-1 gap-2">
              <div className="grid max-w-full grid-cols-[74px_minmax(0,1fr)] items-center gap-2" data-tour-id="planning-task-scope">
                <div className="text-xs font-semibold uppercase text-slate-500">Aufgaben</div>
                <div className="flex min-w-0 flex-nowrap gap-2 overflow-x-auto pb-1 [contain:inline-size] sm:flex-wrap sm:overflow-visible sm:pb-0 sm:[contain:none]">
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
                <div className="flex min-w-0 flex-nowrap gap-2 overflow-x-auto pb-1 [contain:inline-size] sm:flex-wrap sm:overflow-visible sm:pb-0 sm:[contain:none]">
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
            <div className={`grid items-center gap-2 sm:flex sm:flex-wrap md:shrink-0 md:justify-end ${headerActions.length > 1 ? "grid-cols-2" : "grid-cols-[max-content]"}`}>
              {actionButtons}
            </div>
          </div>
        </div>
      )}
      {!filtersAvailable && headerActions.length > 0 && workspace !== "notifications" && (
        <div className="flex justify-end border-t border-slate-100 px-4 py-3 lg:px-6">
          <div className={`grid w-full gap-2 sm:flex sm:w-auto sm:flex-wrap ${headerActions.length > 1 ? "grid-cols-2" : "grid-cols-[max-content]"}`}>{actionButtons}</div>
        </div>
      )}
      </AppHeader>
      {activeTestPersona ? (
        <div className="sticky top-0 z-40 min-[1200px]:hidden">
          <TestProfileBanner
            initials={activeTestPersona.initials}
            label={activeTestPersona.label}
            onOpen={openAccountMenu}
            onEnd={() => setDevProfileId("")}
          />
        </div>
      ) : null}
      {filtersAvailable ? (
        <div
          data-mobile-planning-toolbar
          className={`sticky z-30 border-b border-slate-200 bg-white/95 backdrop-blur min-[1200px]:hidden ${activeTestPersona ? "top-10" : "top-0"}`}
        >
          <div className="flex h-12 min-w-0 items-center gap-2 overflow-x-auto px-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <button
              type="button"
              data-tour-id="planning-task-scope"
              aria-pressed={mineActive}
              onClick={() => setFilters({
                ...filters,
                assignee: "Alle",
                quick: mineActive
                  ? filters.quick.filter((item) => item !== "mine")
                  : Array.from(new Set(["mine", ...filters.quick])),
              })}
              className={`inline-flex h-10 shrink-0 items-center gap-2 rounded-md border px-3 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                mineActive ? "border-blue-300 bg-blue-50 text-blue-700" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
              }`}
            >
              <UserRound size={16} aria-hidden="true" />
              {mineActive ? "Meine" : "Alle"}
            </button>
            <CustomSelect
              aria-label="Planungsansicht wechseln"
              value={view}
              onChange={(nextView) => setView(nextView as ViewMode)}
              options={viewTabs.map((tab) => ({ value: tab.id, label: tab.label }))}
              className="h-10 w-24 shrink-0 text-sm"
              menuClassName="min-w-36"
            />
            <button
              type="button"
              data-tour-id="planning-mobile-filter-trigger"
              onClick={() => setShowFilters(true)}
              aria-expanded={showFilters}
              aria-controls="planning-mobile-filter-sheet"
              className={`relative inline-flex h-10 shrink-0 items-center gap-2 rounded-md border px-3 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                planningFiltersDirty ? "border-blue-300 bg-blue-50 text-blue-700" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
              }`}
            >
              <SlidersHorizontal size={16} aria-hidden="true" />
              Filter
              {planningFiltersDirty ? <span className="h-2 w-2 rounded-full bg-blue-600" aria-label="Filter aktiv" /> : null}
            </button>
            {view === "board" ? (
              <div data-tour-id="planning-kanban-level-switch" className="w-36 shrink-0">
                <CustomSelect
                  aria-label="Planungsebene im Kanban wechseln"
                  value={planningLevel}
                  onChange={(level) => setPlanningLevel(level as PlanningLevel)}
                  options={planningLevels.map((level) => ({
                    value: level.value,
                    label: `${level.label} · ${data.tasks.filter((task) => task.taskType === level.value).length}`,
                  }))}
                  className="h-10 text-sm"
                  menuClassName="min-w-44"
                />
              </div>
            ) : null}
            {actionButtons.length > 0 ? <div className="flex shrink-0 items-center gap-2">{actionButtons}</div> : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
