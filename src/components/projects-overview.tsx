"use client";

import { formatDate, initiativeMetaLabel, initiativeRaciRows } from "@/lib/display";
import { normalizeStatus } from "@/lib/status";
import type { Package, PlanningData, Profile, Task } from "@/lib/types";

export function ProjectsOverview({
  data,
  tasks,
  currentProfile,
  canManageInitiatives,
  onEditInitiative,
}: {
  data: PlanningData;
  tasks: Task[];
  currentProfile?: Profile | null;
  canManageInitiatives: boolean;
  onEditInitiative: (initiative: Package) => void;
}) {
  const milestones = data.milestones.length
    ? data.milestones
    : [{ id: "", title: "Ohne Epic", description: "Initiativen ohne zugeordneten Meilenstein.", targetDate: "", status: "planned" as const, sortOrder: 999 }];
  const profileName = (profileId?: string) => data.profiles.find((profile) => profile.id === profileId)?.name || "Nicht gesetzt";

  return (
    <div className="grid gap-4">
      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Aktives Projekt</div>
        <h2 className="mt-1 text-lg font-semibold text-slate-950">{data.project.name}</h2>
        <p className="mt-1 text-sm text-slate-500">Struktur: Epic / Meilenstein → Initiative → Deliverable → Sub-Issue. Sprints sind der Zeitcontainer für Deliverables.</p>
      </section>
      <section className="grid gap-4">
        {milestones.map((milestone) => {
          const groups = data.packages.filter((pack) => (milestone.id ? pack.milestoneId === milestone.id : !pack.milestoneId));
          const milestoneTasks = tasks.filter((task) => groups.some((pack) => pack.id === task.packageId));
          return (
            <article key={milestone.id || "without-epic"} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-blue-700">Epic / Meilenstein</div>
                  <h3 className="mt-1 text-base font-semibold text-slate-950">{milestone.title}</h3>
                  <p className="mt-1 text-sm leading-6 text-slate-600">{milestone.description}</p>
                </div>
                <span className="rounded-full border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-600">{milestoneTasks.length} Deliverables</span>
              </div>
              <div className="mt-4 grid gap-3 lg:grid-cols-2">
                {groups.map((pack) => {
                  const packageTasks = tasks.filter((task) => task.packageId === pack.id && task.taskType !== "sub_issue");
                  const done = packageTasks.filter((task) => normalizeStatus(task.status) === "Erledigt").length;
                  const blocked = packageTasks.filter((task) => task.dependsOn || normalizeStatus(task.status) === "Blockiert").length;
                  const canEdit = canManageInitiatives || pack.ownerId === currentProfile?.id;
                  return (
                    <div key={pack.id} className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-xs font-semibold text-blue-700">{initiativeMetaLabel(pack)}</div>
                          <h4 className="mt-1 text-sm font-semibold text-slate-950">{pack.title}</h4>
                          <div className="mt-1 text-xs text-slate-500">Owner: {profileName(pack.ownerId)}{pack.targetDate ? ` · Zieltermin: ${formatDate(pack.targetDate)}` : ""}</div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <span className="rounded-full border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-600">{packageTasks.length} Deliverables</span>
                          {canEdit && (
                            <button type="button" onClick={() => onEditInitiative(pack)} className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                              Bearbeiten
                            </button>
                          )}
                        </div>
                      </div>
                      <p className="mt-2 text-sm leading-6 text-slate-600">{pack.goal}</p>
                      <div className="mt-3 grid gap-1 rounded-md border border-slate-200 bg-white p-2 text-xs text-slate-600">
                        {initiativeRaciRows(pack, data.profiles).map((row) => (
                          <div key={row.label} className="flex min-w-0 gap-2">
                            <span className="w-4 shrink-0 font-semibold text-blue-700">{row.label}</span>
                            <span className="min-w-0 truncate" title={`${row.title}: ${row.value}`}>{row.value}</span>
                          </div>
                        ))}
                      </div>
                      {pack.successCriteria && (
                        <p className="mt-2 text-xs leading-5 text-slate-500"><span className="font-semibold text-slate-700">Erfolgskriterien:</span> {pack.successCriteria}</p>
                      )}
                      {pack.scopeConstraints && (
                        <p className="mt-1 text-xs leading-5 text-slate-500"><span className="font-semibold text-slate-700">Constraints:</span> {pack.scopeConstraints}</p>
                      )}
                      <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
                        <div className="rounded-md bg-white p-2"><div className="text-xs text-slate-500">Erledigt</div><div className="font-semibold text-slate-900">{done}</div></div>
                        <div className="rounded-md bg-white p-2"><div className="text-xs text-slate-500">Blockiert</div><div className="font-semibold text-slate-900">{blocked}</div></div>
                        <div className="rounded-md bg-white p-2"><div className="text-xs text-slate-500">Aufwand</div><div className="font-semibold text-slate-900">{packageTasks.reduce((sum, task) => sum + task.hours, 0)}h</div></div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </article>
          );
        })}
      </section>
    </div>
  );
}
