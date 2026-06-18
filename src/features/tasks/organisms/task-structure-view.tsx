import { ChevronRight } from "lucide-react";
import { TaskCard } from "@/features/tasks/molecules/task-card";
import { initiativeMetaLabel } from "@/lib/display";
import { normalizeStatus } from "@/lib/status";
import type { Package, Task, TaskRelation, TaskStatus } from "@/lib/types";

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
        <button type="button" onClick={() => onSetAllPackageCollapse(true)} className="h-8 rounded-md border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50">
          Alle einklappen
        </button>
        <button type="button" onClick={() => onSetAllPackageCollapse(false)} className="h-8 rounded-md border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50">
          Alle ausklappen
        </button>
      </div>
      {packages.map((pack) => {
        const tasks = visibleTasks.filter((task) => task.packageId === pack.id);
        const expanded = Boolean(expandedPackages[pack.id]);
        return (
          <section key={pack.id} className="rounded-lg border border-slate-200 bg-white shadow-sm">
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
              <span className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600">{tasks.length} Aufgaben</span>
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
                      onOpen={onOpenTask}
                      onStatusChange={(nextTask, nextStatus) => onUpdateTask(nextTask, { status: nextStatus })}
                    />
                  );
                })}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
