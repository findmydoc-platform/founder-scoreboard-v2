import { AppSidebar } from "@/features/planning/organisms/app-sidebar";
import { workspaceDescriptions, workspaceLabels } from "@/features/planning/model/planning-app-model";
import type { AppWorkspace } from "@/features/planning/model/workspace-routes";
import { BacklogContentSkeleton } from "@/features/backlog/organisms/backlog-content-skeleton";
import { UiPanel } from "@/shared/atoms/ui-primitives";
import { UiSkeletonChips, UiSkeletonPulse as Pulse } from "@/shared/atoms/skeleton-primitives";

export type WorkspaceLoadingVariant = AppWorkspace | "review-detail" | "task-detail" | "generic";

type WorkspaceLoadingShellProps = {
  workspace?: AppWorkspace;
  variant?: WorkspaceLoadingVariant;
};

const loadingTitles: Record<AppWorkspace, string> = {
  planning: "Projekt wird geladen",
  backlog: "Backlog wird geladen",
  reviews: "Reviews werden geladen",
  events: "Events werden geladen",
  sprint: "Sprint & Score wird geladen",
  projects: "Meilensteine werden geladen",
  tools: "Quicklinks werden geladen",
  team: "Team wird geladen",
  settings: "Einstellungen werden geladen",
  "ceo-intake": "CEO Intake wird geladen",
  profile: "Profil wird geladen",
};

function HeaderLoading({ workspace }: { workspace: AppWorkspace }) {
  return (
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 px-4 py-4 backdrop-blur lg:px-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{workspaceLabels[workspace]}</div>
          <h1 className="mt-1 text-xl font-semibold text-slate-950">{loadingTitles[workspace]}</h1>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">{workspaceDescriptions[workspace]}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Pulse className="h-9 w-9" />
          <Pulse className="h-9 w-28" />
          <Pulse className="h-9 w-20" />
        </div>
      </div>
    </header>
  );
}

function MetricSkeleton({ columns = 4 }: { columns?: 3 | 4 }) {
  return (
    <section className={`grid gap-3 sm:grid-cols-2 ${columns === 4 ? "xl:grid-cols-4" : "xl:grid-cols-3"}`}>
      {Array.from({ length: columns }).map((_, index) => (
        <div key={index} className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <Pulse className="h-3 w-24" />
          <Pulse className="mt-4 h-7 w-14 bg-slate-100" />
        </div>
      ))}
    </section>
  );
}

function ChipSkeleton({ count = 4 }: { count?: number }) {
  return <UiSkeletonChips count={count} />;
}

function PlanningBoardSkeleton() {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {[0, 1, 2].map((column) => (
        <div key={column} className="rounded-lg border border-slate-100 bg-slate-50 p-3">
          <div className="flex items-center justify-between gap-3">
            <Pulse className="h-4 w-28" />
            <Pulse className="h-6 w-8 bg-slate-100" />
          </div>
          <div className="mt-4 grid gap-3">
            {[0, 1, 2].map((item) => (
              <div key={item} className="rounded-md border border-slate-100 bg-white p-3">
                <Pulse className="h-4 w-3/4" />
                <Pulse className="mt-3 h-3 w-1/2 bg-slate-100" />
                <div className="mt-4 flex gap-2">
                  <Pulse className="h-6 w-16 bg-slate-100" />
                  <Pulse className="h-6 w-12 bg-slate-100" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function PlanningContentSkeleton() {
  return (
    <div className="grid gap-4">
      <MetricSkeleton />
      <UiPanel as="div" className="grid gap-3">
        <div className="grid max-w-full grid-cols-[74px_minmax(0,1fr)] items-center gap-2">
          <Pulse className="h-3 w-16" />
          <ChipSkeleton count={2} />
        </div>
        <div className="grid max-w-full grid-cols-[74px_minmax(0,1fr)] items-center gap-2">
          <Pulse className="h-3 w-14" />
          <ChipSkeleton />
        </div>
      </UiPanel>
      <UiPanel as="div" className="min-h-[360px]">
        <PlanningBoardSkeleton />
      </UiPanel>
    </div>
  );
}

function ReviewContentSkeleton() {
  return (
    <div className="grid gap-4">
      <UiPanel as="div">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Pulse className="h-5 w-36" />
            <Pulse className="mt-3 h-4 w-64 bg-slate-100" />
          </div>
          <div className="flex gap-2">
            <Pulse className="h-9 w-16 bg-slate-100" />
            <Pulse className="h-9 w-40 bg-slate-100" />
          </div>
        </div>
        <div className="mt-4">
          <ChipSkeleton count={5} />
        </div>
      </UiPanel>
      <UiPanel as="div" padding="none" className="overflow-hidden">
        <div className="border-b border-slate-100 px-4 py-3">
          <Pulse className="h-5 w-24" />
          <Pulse className="mt-2 h-3 w-20 bg-slate-100" />
        </div>
        <div className="overflow-hidden">
          <div className="grid min-w-[760px] grid-cols-[2fr_1fr_1fr_1fr_120px] border-b border-slate-200 bg-slate-50 px-4 py-3">
            {Array.from({ length: 5 }).map((_, index) => <Pulse key={index} className="h-3 w-20" />)}
          </div>
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="grid min-w-[760px] grid-cols-[2fr_1fr_1fr_1fr_120px] items-center gap-3 border-b border-slate-100 px-4 py-4">
              <div>
                <Pulse className="h-4 w-64" />
                <Pulse className="mt-2 h-3 w-44 bg-slate-100" />
              </div>
              <Pulse className="h-4 w-28 bg-slate-100" />
              <Pulse className="h-4 w-28 bg-slate-100" />
              <Pulse className="h-4 w-20 bg-slate-100" />
              <Pulse className="h-8 w-28 bg-slate-100" />
            </div>
          ))}
        </div>
      </UiPanel>
    </div>
  );
}

function EventsContentSkeleton() {
  return (
    <div className="grid gap-4">
      <UiPanel as="div">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Pulse className="h-5 w-32" />
            <Pulse className="mt-3 h-4 w-80 bg-slate-100" />
          </div>
          <Pulse className="h-9 w-32 bg-slate-100" />
        </div>
        <div className="mt-4">
          <MetricSkeleton />
        </div>
        <div className="mt-4">
          <ChipSkeleton />
        </div>
      </UiPanel>
      <section className="grid gap-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <UiPanel key={index} as="article">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex gap-2">
                  <Pulse className="h-6 w-20 bg-slate-100" />
                  <Pulse className="h-6 w-24 bg-slate-100" />
                </div>
                <Pulse className="mt-3 h-5 w-64" />
                <div className="mt-3 flex flex-wrap gap-3">
                  <Pulse className="h-4 w-36 bg-slate-100" />
                  <Pulse className="h-4 w-28 bg-slate-100" />
                  <Pulse className="h-4 w-40 bg-slate-100" />
                </div>
              </div>
              <Pulse className="h-8 w-24 bg-slate-100" />
            </div>
          </UiPanel>
        ))}
      </section>
    </div>
  );
}

function GenericWorkspaceSkeleton() {
  return (
    <div className="grid gap-4">
      <MetricSkeleton columns={3} />
      <UiPanel as="div" className="grid min-h-72 gap-4">
        <Pulse className="h-5 w-40" />
        <div className="grid gap-3 md:grid-cols-3">
          {[0, 1, 2].map((item) => (
            <div key={item} className="rounded-md border border-slate-100 bg-slate-50 p-4">
              <Pulse className="h-3 w-24" />
              <Pulse className="mt-5 h-8 w-16 bg-slate-100" />
            </div>
          ))}
        </div>
        <Pulse className="h-32 bg-slate-100" />
      </UiPanel>
    </div>
  );
}

function DetailContentSkeleton({ variant }: { variant: "review-detail" | "task-detail" }) {
  const reviewDetail = variant === "review-detail";
  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{reviewDetail ? "Review" : "Aufgabe"}</div>
          <Pulse className="mt-2 h-6 w-[min(70vw,520px)]" />
        </div>
        <Pulse className="h-9 w-36 bg-slate-100" />
      </div>
      <div className={reviewDetail ? "grid gap-5" : "grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]"}>
        <div className="grid min-w-0 gap-5">
          <UiPanel as="div" padding="lg" className="grid gap-4">
            <Pulse className="h-5 w-36" />
            <Pulse className="h-4 w-full bg-slate-100" />
            <Pulse className="h-4 w-5/6 bg-slate-100" />
            <Pulse className="h-28 bg-slate-100" />
          </UiPanel>
          <UiPanel as="div" padding="lg" className="grid gap-3">
            <Pulse className="h-5 w-28" />
            {[0, 1, 2].map((item) => <Pulse key={item} className="h-12 bg-slate-100" />)}
          </UiPanel>
        </div>
        {!reviewDetail && (
          <aside className="grid content-start gap-5">
            {[0, 1, 2].map((item) => (
              <UiPanel key={item} as="div" padding="lg" className="grid gap-3">
                <Pulse className="h-5 w-32" />
                <Pulse className="h-4 w-full bg-slate-100" />
                <Pulse className="h-4 w-2/3 bg-slate-100" />
              </UiPanel>
            ))}
          </aside>
        )}
      </div>
    </div>
  );
}

export function WorkspaceContentSkeleton({ variant = "generic" }: { variant?: WorkspaceLoadingVariant }) {
  if (variant === "planning") return <PlanningContentSkeleton />;
  if (variant === "backlog") return <BacklogContentSkeleton />;
  if (variant === "reviews") return <ReviewContentSkeleton />;
  if (variant === "events") return <EventsContentSkeleton />;
  if (variant === "review-detail" || variant === "task-detail") return <DetailContentSkeleton variant={variant} />;
  return <GenericWorkspaceSkeleton />;
}

export function WorkspaceLoadingShell({ workspace = "planning", variant = workspace }: WorkspaceLoadingShellProps) {
  const detailVariant = variant === "review-detail" || variant === "task-detail";

  return (
    <div className="min-h-screen bg-[#f4f7fb] text-slate-900">
      <AppSidebar activeWorkspace={workspace} />
      <main className="lg:pl-16">
        {detailVariant ? (
          <div className="mx-auto max-w-7xl px-6 py-6">
            <WorkspaceContentSkeleton variant={variant} />
          </div>
        ) : (
          <>
            <HeaderLoading workspace={workspace} />
            <section className="grid gap-4 px-4 py-4 lg:px-6">
              <WorkspaceContentSkeleton variant={variant} />
            </section>
          </>
        )}
      </main>
    </div>
  );
}
