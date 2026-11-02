"use client";

import { Maximize2, Menu, Minimize2 } from "lucide-react";
import { FmdToolQuickLinks } from "@/features/tools/molecules/fmd-tool-quick-links";
import { HeaderCalendarAction } from "@/features/planning/molecules/header-calendar-action";
import { NotificationInbox } from "@/features/notifications/organisms/notification-inbox";
import { PlanningNotificationFeedback } from "@/features/planning/molecules/planning-notification-feedback";
import { PlanningHelpMenu } from "@/features/planning/molecules/planning-help-menu";
import { GitHubSyncTrigger } from "@/features/tasks/molecules/github-sync-trigger";
import { AuthControl } from "@/features/settings/organisms/auth-control";
import { ApplicationContextBar } from "../molecules/application-context-bar";
import { useApplicationHeaderRuntime } from "../hooks/use-application-header-runtime";
import type { ApplicationHeaderProps } from "../model/application-header";

export function ApplicationHeader({ area, lifecycle, navigation, context, focus, notices }: ApplicationHeaderProps) {
  const AreaHeading = area.heading === false ? "p" : "h1";
  const runtime = useApplicationHeaderRuntime(lifecycle, navigation);
  const account = lifecycle.account ? (
    <AuthControl
      {...lifecycle.account}
      onOpenProfile={() => navigation.navigate("/profile")}
      onOpenAdministration={() => navigation.navigate("/administration")}
    />
  ) : null;
  const standardActions = (
    <>
      <PlanningNotificationFeedback />
      <FmdToolQuickLinks quickLinks={runtime.headerData.quickLinks} open={runtime.quickLinksOpen} onToggle={runtime.toggleQuickLinks} />
      <HeaderCalendarAction planningState={lifecycle.enabled ? lifecycle.planningState : undefined} events={runtime.headerData.calendarEvents} onOpenTeam={runtime.openTeam} profiles={lifecycle.profiles} profilesSlot={lifecycle.calendarProfiles} />
      <NotificationInbox notifications={runtime.headerData.notifications} open={runtime.notificationsOpen} onToggle={runtime.toggleNotifications} onOpen={runtime.openNotification} onDismiss={runtime.dismissNotification} />
      <PlanningHelpMenu />
      <GitHubSyncTrigger {...lifecycle.github} />
      {account}
    </>
  );
  return (
    <div className="relative z-20 min-w-0 border-b border-slate-200 bg-white/95 backdrop-blur min-[1200px]:sticky min-[1200px]:top-0">
      <header aria-label="Anwendung">
        {notices}
        <div className={focus?.active ? "flex min-h-12 items-center justify-between gap-3 px-4 py-2 lg:px-6" : "flex flex-wrap items-start justify-between gap-3 px-4 py-3 sm:gap-4 sm:px-5 sm:py-5 lg:px-6 min-[1200px]:flex-nowrap min-[1200px]:items-center min-[1200px]:px-8"}>
          <div className="flex min-w-0 max-w-full items-start gap-3 min-[1200px]:flex-1">
            {!focus?.active ? (
              <button
                type="button"
                onClick={navigation.openMobileNav}
                aria-label="Navigation öffnen"
                aria-expanded={navigation.mobileNavOpen}
                className="grid h-11 w-11 shrink-0 place-items-center rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-blue-500 lg:hidden"
              >
                <Menu size={19} aria-hidden="true" />
              </button>
            ) : null}
            <div className="min-w-0">
              <div className="text-xs font-medium text-slate-500">{focus?.active ? "Fokusmodus" : "FounderOps"}</div>
              <AreaHeading className={focus?.active ? "truncate text-sm font-semibold text-slate-800" : "truncate text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl"}>{area.title}</AreaHeading>
              {!focus?.active && area.supportingContext ? <p className="mt-1 truncate text-sm font-medium text-slate-600">{area.supportingContext}</p> : null}
              {!focus?.active && area.description ? <p className="mt-1.5 hidden max-w-2xl text-sm leading-6 text-slate-500 sm:block">{area.description}</p> : null}
            </div>
          </div>
          <div className={focus?.active ? "flex shrink-0 items-center gap-2" : "flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto sm:justify-end min-[1200px]:ml-auto min-[1200px]:max-w-[52%]"}>
            {focus?.active ? (
              <>
                <button type="button" onClick={focus.toggle} className="inline-flex min-h-11 items-center gap-2 rounded-md border border-slate-200 px-3 text-sm font-semibold text-slate-700 focus-visible:ring-2 focus-visible:ring-blue-500">
                  <Minimize2 size={16} aria-hidden="true" />Fokusmodus beenden
                </button>
                {account}
              </>
            ) : standardActions}
          </div>
        </div>
      </header>
      {!focus?.active && (context || focus) ? (
        <ApplicationContextBar>
          <div className="flex min-w-0 items-start gap-2">
            <div className="min-w-0 flex-1">{context}</div>
            {focus ? (
              <button type="button" onClick={focus.toggle} aria-pressed={false} aria-label="Fokusmodus" title="Fokusmodus im Vollbild starten" className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-700 hover:bg-blue-50 focus-visible:ring-2 focus-visible:ring-blue-500 min-[1200px]:h-9 min-[1200px]:w-9">
                <Maximize2 size={16} aria-hidden="true" />
              </button>
            ) : null}
          </div>
        </ApplicationContextBar>
      ) : null}
    </div>
  );
}
