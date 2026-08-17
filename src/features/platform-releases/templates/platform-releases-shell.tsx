"use client";

import type { User } from "@supabase/supabase-js";
import { useState, type ReactNode } from "react";
import { PlanningHeaderDataActions } from "@/features/planning/molecules/planning-header-data-actions";
import { PlanningHelpMenu } from "@/features/planning/molecules/planning-help-menu";
import { AppHeader } from "@/features/planning/organisms/app-header";
import { AppSidebar } from "@/features/planning/organisms/app-sidebar";
import { AuthControl } from "@/features/settings/organisms/auth-control";
import { getBrowserSupabase } from "@/lib/supabase";
import type { PlanningHeaderData } from "@/lib/types";

type Props = {
  authUser?: User | null;
  children: ReactNode;
  currentPlatformRole?: string;
  headerData: PlanningHeaderData;
};

export function PlatformReleasesShell({ authUser = null, children, currentPlatformRole = "", headerData }: Props) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const signOut = async () => {
    const supabase = getBrowserSupabase();
    if (!supabase) return;
    setAuthBusy(true);
    const { error } = await supabase.auth.signOut({ scope: "global" });
    setAuthBusy(false);
    if (!error) window.location.assign("/");
  };
  return (
    <div className="min-h-screen bg-white text-slate-950">
      <AppSidebar
        activeWorkspace="platform-releases"
        currentPlatformRole={currentPlatformRole}
        mobileOpen={mobileOpen}
        onMobileClose={() => setMobileOpen(false)}
      />
      <main className="app-sidebar-main min-w-0">
        <AppHeader
          mobileNavOpen={mobileOpen}
          onOpenMobileNav={() => setMobileOpen(true)}
          eyebrow="FounderOps"
          title="Releases"
          description="Auslieferungen einzelner Anwendungen und der gemeinsamen Plattform."
          actions={(
            <>
              <PlanningHeaderDataActions headerData={headerData} />
              <PlanningHelpMenu />
              {authUser ? (
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
        {children}
      </main>
    </div>
  );
}
