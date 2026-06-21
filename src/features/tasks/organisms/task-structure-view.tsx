import { ChevronRight } from "lucide-react";
import { TaskCard } from "@/features/tasks/molecules/task-card";
import { initiativeMetaLabel } from "@/lib/display";
import { normalizeStatus } from "@/lib/status";
import type { Package, Task, TaskRelation, TaskStatus } from "@/lib/types";
import { UiBadge, UiButton } from "@/shared/atoms/ui-primitives";
import { DataSurface } from "@/shared/molecules/data-surface";

type TaskStructureViewProps = {
  packages: Package[];
  visibleTasks: Task[];
  relations: TaskRelation[];
  allTasks: Task[];
  expandedPackages: Record<string, boolean>;
  canChangeTaskStatus: (task: Task) => boolean;
  statusOptionsForTask: (task: Task) => TaskStatus[];
  ownerColorForTask: (task: Task) => string;
  onOpenTask: (task: Task) => void;
  onUpdateTask: (task: Task, patch: Partial<Task>) => void;
  onTogglePackage: (packageId: string) => void;
  onSetAllPackageCollapse: (collapsed: boolean) => void;
};

export function TaskStructureView({
  packages,
  visibleTasks,
  relations,
  allTasks,
  expandedPackages,
  canChangeTaskStatus,
  statusOptionsForTask,
  ownerColorForTask,
  onOpenTask,
  onUpdateTask,
  onTogglePackage,
  onSetAllPackageCollapse,
}: TaskStructureViewProps) {
  return (
    <div className="grid gap-4">
      <div className="flex justify-end gap-2">
        <UiButton type="button" onClick={() => onSetAllPackageCollapse(true)} size="sm">
          Alle einklappen
        </UiButton>
        <UiButton type="button" onClick={() => onSetAllPackageCollapse(false)} size="sm">
          Alle ausklappen
        </UiButton>
      </div>
      {packages.map((pack) => {
        const tasks = visibleTasks.filter((task) => task.packageId === pack.id);
        const expanded = Boolean(expandedPackages[pack.id]);
        return (
          <DataSurface key={pack.id}>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
              <button type="button" onClick={() => onTogglePackage(pack.id)} className="flex min-w-0 flex-1 items-start gap-3 rounded-md text-left outline-none focus:ring-2 focus:ring-blue-100" aria-expanded={expanded}>
                <span className="mt-1 grid h-7 w-7 shrink-0 place-items-center rounded-md border border-slate-200 bg-white text-slate-500">
                  <ChevronRight size={16} className={`transition-transform ${expanded ? "rotate-90" : ""}`} />
                </span>
                <span className="min-w-0">
                  <span className="block text-xs font-semibold text-blue-700">{initiativeMetaLabel(pack)}</span>
                  <span className="mt-0.5 block text-base font-semibold text-slate-950">{pack.title}</span>
                  <span className="mt-1 block text-sm text-slate-500">{pack.goal}</span>
                </span>
              </button>
              <UiBadge tone="white" size="md">{tasks.length} Aufgaben</UiBadge>
            </div>
            {expanded && (
              <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
                {tasks.map((task) => {
                  const canUpdateStatus = canChangeTaskStatus(task);
                  return (
                    <TaskCard
                      key={task.id}
                      task={task}
                      pack={pack}
                      ownerColor={ownerColorForTask(task)}
                      relations={relations}
                      allTasks={allTasks}
                      statusOptions={canUpdateStatus ? statusOptionsForTask(task) : [normalizeStatus(task.status)]}
                      statusDisabled={!canUpdateStatus}
                      showStatus={false}
                      showStatusControl={false}
                      onOpen={onOpenTask}
                      onStatusChange={(nextTask, nextStatus) => onUpdateTask(nextTask, { status: nextStatus })}
                    />
                  );
                })}
              </div>
            )}
          </DataSurface>
        );
      })}
    </div>
  );
}
