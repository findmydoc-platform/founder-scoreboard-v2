import { backlogSkeletonGridClassName, backlogTableColumns, backlogTableMinWidthClass } from "@/features/backlog/model/backlog-table-layout";
import { UiPanel } from "@/shared/atoms/ui-primitives";
import { UiSkeletonChips, UiSkeletonPulse } from "@/shared/atoms/skeleton-primitives";

export function BacklogContentSkeleton() {
  return (
    <div className="grid gap-4">
      <UiPanel as="div" className="grid gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <UiSkeletonPulse className="h-5 w-44" />
            <UiSkeletonPulse className="mt-3 h-4 w-72 bg-slate-100" />
          </div>
          <UiSkeletonPulse className="h-9 w-64 bg-slate-100" />
        </div>
        <div className="grid max-w-full grid-cols-[116px_minmax(0,1fr)] items-center gap-2">
          <UiSkeletonPulse className="h-3 w-24" />
          <UiSkeletonChips />
        </div>
      </UiPanel>
      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <UiPanel as="div" padding="none" className="overflow-hidden">
          <div className="overflow-x-scroll">
            <div className={`grid ${backlogTableMinWidthClass} ${backlogSkeletonGridClassName} border-b border-slate-200 bg-slate-50 px-3 py-3`}>
              {backlogTableColumns.map((column) => <UiSkeletonPulse key={column.id} className={`h-3 ${column.skeletonWidth}`} />)}
            </div>
            {Array.from({ length: 7 }).map((_, index) => (
              <div key={index} className={`grid ${backlogTableMinWidthClass} ${backlogSkeletonGridClassName} items-start gap-3 border-b border-slate-100 px-3 py-4`}>
                <UiSkeletonPulse className="h-5 w-5 bg-slate-100" />
                <UiSkeletonPulse className="h-4 w-8" />
                <div>
                  <UiSkeletonPulse className="h-4 w-56" />
                  <UiSkeletonPulse className="mt-3 h-3 w-44 bg-slate-100" />
                </div>
                <UiSkeletonPulse className="h-6 w-20 bg-slate-100" />
                <UiSkeletonPulse className="h-4 w-32 bg-slate-100" />
                <UiSkeletonPulse className="h-4 w-20 bg-slate-100" />
                <UiSkeletonPulse className="h-6 w-10 bg-slate-100" />
                <UiSkeletonPulse className="h-4 w-10 bg-slate-100" />
                <div className="flex gap-2">
                  <UiSkeletonPulse className="h-6 w-6 bg-slate-100" />
                  <UiSkeletonPulse className="h-6 w-6 bg-slate-100" />
                  <UiSkeletonPulse className="h-6 w-6 bg-slate-100" />
                </div>
                <UiSkeletonPulse className="h-4 w-16 bg-slate-100" />
              </div>
            ))}
          </div>
        </UiPanel>
        <UiPanel as="div" padding="none" className="overflow-hidden">
          <div className="border-b border-slate-100 px-4 py-3">
            <UiSkeletonPulse className="h-5 w-20" />
            <UiSkeletonPulse className="mt-2 h-3 w-52 bg-slate-100" />
          </div>
          {Array.from({ length: 2 }).map((_, index) => (
            <div key={index} className="border-b border-slate-100 px-4 py-4 last:border-b-0">
              <UiSkeletonPulse className="h-4 w-40" />
              <UiSkeletonPulse className="mt-3 h-3 w-32 bg-slate-100" />
              <UiSkeletonPulse className="mt-5 h-2 w-full bg-slate-100" />
              <UiSkeletonPulse className="mt-4 h-10 w-full bg-slate-100" />
            </div>
          ))}
        </UiPanel>
      </div>
    </div>
  );
}
