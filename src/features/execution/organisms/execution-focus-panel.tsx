import type { Dispatch, SetStateAction } from "react";
import { focusStatusLabel, formatDate } from "@/lib/display";
import { hasOpenWaitingRelation } from "@/lib/platform";
import { normalizeStatus, priorityTone, statusTone } from "@/lib/status";
import { profileColor } from "@/features/execution/model/execution-layer-view-model";
import type { Profile, Task, TaskFocusItem, TaskRelation } from "@/lib/types";

type FocusDraftSetter = Dispatch<SetStateAction<Record<string, string>>>;

export function ExecutionFocusPanel({
  currentProfile,
  isOperationalLead,
  focusItems,
  focusDrafts,
  setFocusDrafts,
  taskById,
  focusStatusCounts,
  endOfDayOpenItems,
  endOfDayCompletion,
  todayTeamFocusItems,
  focusHistoryByDate,
  focusHistoryDates,
  visibleProfiles,
  suggestedTasks,
  allTasks,
  taskRelations,
  pending,
  onOpenTask,
  onSetFocus,
  onRemoveFocus,
}: {
  currentProfile: Profile | null;
  isOperationalLead: boolean;
  focusItems: TaskFocusItem[];
  focusDrafts: Record<string, string>;
  setFocusDrafts: FocusDraftSetter;
  taskById: Map<string, Task>;
  focusStatusCounts: Record<TaskFocusItem["status"], number>;
  endOfDayOpenItems: TaskFocusItem[];
  endOfDayCompletion: number;
  todayTeamFocusItems: TaskFocusItem[];
  focusHistoryByDate: Record<string, TaskFocusItem[]>;
  focusHistoryDates: string[];
  visibleProfiles: Profile[];
  suggestedTasks: Task[];
  allTasks: Task[];
  taskRelations: TaskRelation[];
  pending: boolean;
  onOpenTask: (task: Task) => void;
  onSetFocus: (task: Task, nextStep: string, status?: TaskFocusItem["status"]) => void;
  onRemoveFocus: (focusItem: TaskFocusItem) => void;
}) {
  return (
    <section className="min-w-0 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-950">Heute-Fokus</h2>
          <p className="mt-1 text-sm text-slate-500">Maximal drei Aufgaben, nächster Schritt und Tagesstatus.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={pending || !focusItems.some((item) => item.status === "planned")}
            onClick={() => {
              focusItems
                .filter((item) => item.status === "planned")
                .forEach((item) => {
                  const task = taskById.get(item.taskId);
                  if (task) onSetFocus(task, item.nextStep || "Auf morgen verschoben.", "deferred");
                });
            }}
            className="h-8 rounded-md border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            Offene verschieben
          </button>
          <span className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600">
            {currentProfile?.name || "Team"} · {focusItems.length}/3
          </span>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-4">
        {[
          ["Geplant", focusStatusCounts.planned],
          ["Erledigt", focusStatusCounts.done],
          ["Blockiert", focusStatusCounts.blocked],
          ["Entscheidung", focusStatusCounts.needs_decision],
        ].map(([label, value]) => (
          <div key={label} className="min-w-0 rounded-md border border-slate-100 bg-slate-50 px-3 py-2">
            <div className="text-[11px] font-semibold text-slate-500">{label}</div>
            <div className="mt-1 text-lg font-semibold text-slate-950">{value}</div>
          </div>
        ))}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3">
        {focusItems.length ? focusItems.map((item) => {
          const task = taskById.get(item.taskId);
          if (!task) return null;
          return (
            <article key={item.id} className="rounded-md border border-slate-200 bg-slate-50 p-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <button type="button" onClick={() => onOpenTask(task)} className="min-w-0 break-words text-left text-sm font-semibold leading-5 text-slate-950 hover:text-blue-700">
                  {task.title}
                </button>
                <span className="shrink-0 rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700">{focusStatusLabel(item.status)}</span>
              </div>
              <input
                value={focusDrafts[item.taskId] ?? item.nextStep}
                onChange={(event) => setFocusDrafts((current) => ({ ...current, [item.taskId]: event.target.value }))}
                onBlur={() => onSetFocus(task, focusDrafts[item.taskId] ?? item.nextStep, item.status)}
                className="mt-3 h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm outline-none focus:border-blue-400"
                placeholder={task.intendedOutcome || task.description || "Nächsten Schritt ergänzen."}
              />
              <div className="mt-3 flex flex-wrap gap-2">
                {(["done", "blocked", "deferred", "needs_decision"] as TaskFocusItem["status"][]).map((status) => (
                  <button key={status} type="button" disabled={pending} onClick={() => onSetFocus(task, focusDrafts[item.taskId] ?? item.nextStep, status)} className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50">
                    {focusStatusLabel(status)}
                  </button>
                ))}
                <button type="button" disabled={pending} onClick={() => onRemoveFocus(item)} className="h-8 rounded-md border border-red-200 bg-red-50 px-2 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50">
                  Entfernen
                </button>
              </div>
            </article>
          );
        }) : (
          <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
            Noch kein Tagesfokus gesetzt.
          </div>
        )}
      </div>

      <div className="mt-5 rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-950">Tagesabschluss</h3>
            <p className="mt-1 text-xs leading-5 text-slate-500">Offene Fokusaufgaben kurz abschließen, bevor sie in den nächsten Tag rutschen.</p>
          </div>
          <div className="text-right">
            <div className="text-xs font-semibold text-slate-500">Abschlussquote</div>
            <div className="mt-1 text-xl font-semibold text-slate-950">{endOfDayCompletion}%</div>
          </div>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
          <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${endOfDayCompletion}%` }} />
        </div>
        <div className="mt-4 grid gap-2">
          {focusItems.length ? focusItems.map((item) => {
            const task = taskById.get(item.taskId);
            if (!task) return null;
            const currentNextStep = focusDrafts[item.taskId] ?? item.nextStep;
            return (
              <article key={`checkin-${item.id}`} className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <button type="button" onClick={() => onOpenTask(task)} className="min-w-0 text-left text-sm font-semibold text-slate-900 hover:text-blue-700">
                    {task.title}
                  </button>
                  <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-600">{focusStatusLabel(item.status)}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button type="button" disabled={pending} onClick={() => onSetFocus(task, currentNextStep || "Heute erledigt.", "done")} className="h-8 rounded-md border border-emerald-200 bg-emerald-50 px-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50">
                    Als erledigt markieren
                  </button>
                  <button type="button" disabled={pending} onClick={() => onSetFocus(task, currentNextStep || "Blocker für morgen klären.", "blocked")} className="h-8 rounded-md border border-amber-200 bg-amber-50 px-2 text-xs font-semibold text-amber-700 hover:bg-amber-100 disabled:opacity-50">
                    Blockiert
                  </button>
                  <button type="button" disabled={pending} onClick={() => onSetFocus(task, currentNextStep || "Auf morgen verschoben.", "deferred")} className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50">
                    Verschieben
                  </button>
                  <button type="button" disabled={pending} onClick={() => onSetFocus(task, currentNextStep || "Braucht eine Entscheidung.", "needs_decision")} className="h-8 rounded-md border border-blue-200 bg-blue-50 px-2 text-xs font-semibold text-blue-700 hover:bg-blue-100 disabled:opacity-50">
                    Entscheidung nötig
                  </button>
                </div>
              </article>
            );
          }) : (
            <div className="rounded-md border border-dashed border-slate-200 px-3 py-6 text-center text-sm text-slate-500">Kein Tagesfokus für den Abschluss vorhanden.</div>
          )}
        </div>
        {endOfDayOpenItems.length > 0 && (
          <div className="mt-3 rounded-md border border-amber-100 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
            {endOfDayOpenItems.length} Fokusaufgaben sind noch geplant und brauchen einen Abschlussstatus.
          </div>
        )}
      </div>

      <div className="mt-5 grid gap-3 border-t border-slate-100 pt-4 lg:grid-cols-[minmax(0,1fr)_260px]">
        <section>
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-slate-950">{isOperationalLead ? "Team-Fokus heute" : "Mein Fokus heute"}</h3>
            <span className="text-xs font-semibold text-slate-500">{todayTeamFocusItems.length} Fokusaufgaben</span>
          </div>
          <div className="mt-3 grid gap-2">
            {visibleProfiles.map((profile) => {
              const profileFocus = todayTeamFocusItems.filter((item) => item.profileId === profile.id).slice(0, 3);
              return (
                <article key={profile.id} className="rounded-md border border-slate-200 bg-white p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: profileColor(profile) }} />
                      <span className="truncate text-sm font-semibold text-slate-950">{profile.name}</span>
                    </div>
                    <span className="rounded-full border border-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-500">{profileFocus.length}/3</span>
                  </div>
                  <div className="mt-2 grid gap-1">
                    {profileFocus.length ? profileFocus.map((item) => {
                      const task = taskById.get(item.taskId);
                      return task ? (
                        <button key={item.id} type="button" onClick={() => onOpenTask(task)} className="flex items-center justify-between gap-2 rounded-md bg-slate-50 px-2 py-1.5 text-left text-xs hover:bg-blue-50">
                          <span className="min-w-0 truncate font-semibold text-slate-700">{task.title}</span>
                          <span className="shrink-0 text-slate-500">{focusStatusLabel(item.status)}</span>
                        </button>
                      ) : null;
                    }) : (
                      <div className="rounded-md border border-dashed border-slate-200 px-2 py-2 text-xs text-slate-500">Kein Fokus gesetzt.</div>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <section>
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-slate-950">Fokus-Verlauf</h3>
            <span className="text-xs font-semibold text-slate-500">7 Tage</span>
          </div>
          <div className="mt-3 grid gap-2">
            {focusHistoryDates.length ? focusHistoryDates.map((date) => {
              const items = focusHistoryByDate[date] || [];
              const done = items.filter((item) => item.status === "done").length;
              const blocked = items.filter((item) => item.status === "blocked" || item.status === "needs_decision").length;
              return (
                <div key={date} className="rounded-md border border-slate-200 bg-white px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-700">{formatDate(date)}</span>
                    <span className="text-xs text-slate-500">{items.length} Fokus</span>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] font-semibold">
                    <span className="rounded-full bg-emerald-50 px-2 py-1 text-emerald-700">{done} erledigt</span>
                    <span className="rounded-full bg-amber-50 px-2 py-1 text-amber-700">{blocked} kritisch</span>
                  </div>
                </div>
              );
            }) : (
              <div className="rounded-md border border-dashed border-slate-200 px-3 py-8 text-center text-xs text-slate-500">Noch kein Fokus-Verlauf.</div>
            )}
          </div>
        </section>
      </div>

      <div className="mt-5 border-t border-slate-100 pt-4">
        <h3 className="text-sm font-semibold text-slate-950">Vorschläge für heute</h3>
        <div className="mt-3 grid grid-cols-1 gap-3">
          {suggestedTasks.map((task) => (
            <article key={task.id} className="w-full min-w-0 rounded-md border border-slate-200 p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <button type="button" onClick={() => onOpenTask(task)} className="block w-full truncate text-left text-sm font-semibold text-slate-950 hover:text-blue-700">
                    {task.title}
                  </button>
                  <div className="mt-1 flex flex-wrap gap-1.5 text-[11px] font-semibold">
                    <span className={`rounded-full border px-2 py-0.5 ${priorityTone(task.priority)}`}>{task.priority}</span>
                    <span className={`rounded-full border px-2 py-0.5 ${statusTone(normalizeStatus(task.status))}`}>{normalizeStatus(task.status)}</span>
                    {hasOpenWaitingRelation(task.id, allTasks, taskRelations) && <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-amber-700">wartet</span>}
                  </div>
                </div>
                <button
                  type="button"
                  disabled={pending || focusItems.length >= 3}
                  onClick={() => onSetFocus(task, focusDrafts[task.id] || task.intendedOutcome || task.acceptanceCriteria || "Nächsten Schritt klären.", "planned")}
                  className="h-8 rounded-md bg-blue-600 px-3 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  In Fokus
                </button>
              </div>
              <input
                value={focusDrafts[task.id] || ""}
                onChange={(event) => setFocusDrafts((current) => ({ ...current, [task.id]: event.target.value }))}
                className="mt-3 h-9 w-full rounded-md border border-slate-200 px-3 text-sm outline-none focus:border-blue-400"
                placeholder="Nächster Schritt"
              />
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
