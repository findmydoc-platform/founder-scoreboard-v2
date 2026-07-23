import type { User } from "@supabase/supabase-js";
import Link from "next/link";
import { AppSidebar, type AppWorkspace } from "@/features/planning/organisms/app-sidebar";
import { workspaceLabels } from "@/features/planning/model/planning-app-model";
import { AuthControl } from "@/features/settings/organisms/auth-control";
import { UiPanel } from "@/shared/atoms/ui-primitives";

type PlanningBootShellProps = {
  workspace: AppWorkspace;
  source: "supabase";
  authAvailable: boolean;
  authUserEmail: string;
  title: string;
  description: string;
  error?: string;
  authUser?: User | null;
  authBusy?: boolean;
  onSignIn?: () => void;
  onSignOut?: () => void;
  retryHref?: string;
};

export function PlanningBootShell({
  workspace,
  source,
  authAvailable,
  authUserEmail,
  title,
  description,
  error,
  authUser = null,
  authBusy = false,
  onSignIn,
  onSignOut,
  retryHref,
}: PlanningBootShellProps) {
  return (
    <div className="min-h-screen bg-[#f4f7fb] text-slate-900">
      <AppSidebar
        activeWorkspace={workspace}
        source={source}
        authAvailable={authAvailable}
        authUserEmail={authUserEmail}
      />
      <main className="lg:pl-16">
        <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 px-4 py-4 backdrop-blur lg:px-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{workspaceLabels[workspace]}</div>
              <h1 className="mt-1 text-xl font-semibold text-slate-950">{title}</h1>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">{description}</p>
            </div>
            {authUser && onSignIn && onSignOut && (
              <AuthControl
                user={authUser}
                error={error || ""}
                busy={authBusy}
                onSignIn={onSignIn}
                onSignOut={onSignOut}
              />
            )}
          </div>
        </header>
        <section className="grid gap-3 px-4 py-4 sm:grid-cols-2 xl:grid-cols-4 lg:px-6">
          {["w-24", "w-20", "w-28", "w-16"].map((width, index) => (
            <div key={index} className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <div className={`h-3 ${width} animate-pulse rounded bg-slate-200`} />
              <div className="mt-4 h-7 w-14 animate-pulse rounded bg-slate-100" />
            </div>
          ))}
        </section>
        <section className="px-4 pb-8 pt-2 lg:px-6">
          <UiPanel as="div" className="grid min-h-[360px] gap-4 lg:grid-cols-3">
            {[0, 1, 2].map((column) => (
              <div key={column} className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                <div className="h-4 w-28 animate-pulse rounded bg-slate-200" />
                <div className="mt-4 grid gap-3">
                  {[0, 1, 2].map((item) => (
                    <div key={item} className="rounded-md border border-slate-100 bg-white p-3">
                      <div className="h-4 w-3/4 animate-pulse rounded bg-slate-200" />
                      <div className="mt-3 h-3 w-1/2 animate-pulse rounded bg-slate-100" />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </UiPanel>
          {error && (
            <div className="mt-4 flex flex-wrap items-center gap-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
              <p className="min-w-0 flex-1">{error}</p>
              {retryHref && (
                <Link className="rounded-md border border-red-300 bg-white px-3 py-1.5 text-red-800 transition hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500" href={retryHref}>
                  Erneut versuchen
                </Link>
              )}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
