"use client";

import type { User } from "@supabase/supabase-js";
import { useState, type ReactNode } from "react";
import { usePlatformReleaseAuth } from "@/features/platform-releases/hooks/use-platform-release-auth";
import { PlanningHeaderDataActions } from "@/features/planning/molecules/planning-header-data-actions";
import { PlanningHelpMenu } from "@/features/planning/molecules/planning-help-menu";
import { AppHeader } from "@/features/planning/organisms/app-header";
import { AppSidebar } from "@/features/planning/organisms/app-sidebar";
import { AuthControl } from "@/features/settings/organisms/auth-control";
import { usePlanningStateOwner } from "@/features/planning/hooks/use-planning-state-owner";
import { usePlanningHeaderData } from "@/features/planning/hooks/use-planning-header-data";
import { PlanningBusinessStateContext } from "@/features/planning/hooks/use-planning-business-state";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import type { PlanningHeaderData } from "@/lib/types";

type Props = {
  authUser?: User | null;
  children: ReactNode;
  currentPlatformRole?: string;
  headerData: PlanningHeaderData;
};

export function PlatformReleasesShell({ authUser = null, children, currentPlatformRole = "", headerData }: Props) {
  const [, setHeaderData] = useState(headerData);
  const owner = usePlanningStateOwner({ initialData: emptyPlanningShellState, initialHeaderData: headerData, initialCurrentProfile: null, initialUserId: authUser?.id || "", initialWorkspace: "decision-log", setHeaderData });
  const sharedHeader = usePlanningHeaderData({ planningState: owner.planningState, enabled: Boolean(authUser) });
  const [mobileOpen, setMobileOpen] = useState(false);
  const { busy: authBusy, signOut, signedOut } = usePlatformReleaseAuth(authUser?.id);
  return (
    <PlanningBusinessStateContext.Provider value={owner.planningState}><div className="min-h-screen bg-white text-slate-950">
      {!signedOut ? <AppSidebar
        activeWorkspace="platform-releases"
        currentPlatformRole={currentPlatformRole}
        mobileOpen={mobileOpen}
        onMobileClose={() => setMobileOpen(false)}
      /> : null}
      <main className="app-sidebar-main min-w-0">
        <AppHeader
          mobileNavOpen={mobileOpen}
          onOpenMobileNav={() => setMobileOpen(true)}
          eyebrow="FounderOps"
          title="Releases"
          description="Auslieferungen einzelner Anwendungen und der gemeinsamen Plattform."
          actions={(
            <>
              {!signedOut ? <PlanningHeaderDataActions headerData={sharedHeader} /> : null}
              <PlanningHelpMenu />
              {authUser && !signedOut ? (
                <AuthControl
                  user={authUser}
                  busy={authBusy}
                  onSignIn={() => undefined}
                  onSignOut={() => void signOut()}
                  onOpenProfile={() => window.location.assign("/profile")}
                />
              ) : null}
            </>
          )}
        />
        {signedOut ? <p role="status" className="p-6">Du bist abgemeldet. Der Zugriff auf die Releases ist gesperrt.</p> : children}
      </main>
    </div></PlanningBusinessStateContext.Provider>
  );
}
