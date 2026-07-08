import { AppSidebar } from "@/features/planning/organisms/app-sidebar";
import { UiPanel } from "@/shared/atoms/ui-primitives";

export default function WorkspaceLoading() {
  return (
    <div className="min-h-screen bg-[#f4f7fb] text-slate-900">
      <AppSidebar activeWorkspace="planning" />
      <main className="lg:pl-16">
        <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 px-4 py-4 backdrop-blur lg:px-6">
          <div className="h-3 w-24 animate-pulse rounded bg-slate-200" />
          <div className="mt-3 h-6 w-64 max-w-full animate-pulse rounded bg-slate-100" />
          <div className="mt-2 h-4 w-80 max-w-full animate-pulse rounded bg-slate-100" />
        </header>
        <section className="grid gap-3 px-4 py-4 sm:grid-cols-2 xl:grid-cols-4 lg:px-6">
          {[0, 1, 2, 3].map((item) => (
            <div key={item} className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <div className="h-3 w-24 animate-pulse rounded bg-slate-200" />
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
        </section>
      </main>
    </div>
  );
}
