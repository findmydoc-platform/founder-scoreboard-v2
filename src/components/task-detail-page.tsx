"use client";

import { ArrowLeft, CalendarDays, GitBranch, Link2, MessageSquareWarning } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { reviewLabel, syncLabel } from "@/lib/platform";
import { normalizeStatus, priorityTone, statusTone, taskStatuses } from "@/lib/status";
import { getBrowserSupabase } from "@/lib/supabase";
import type { Milestone, Package, PlanningData, Profile, Sprint, Task, TaskBlocker, TaskComment, TaskStatus } from "@/lib/types";
import { TaskCommentThread } from "@/components/task-comment-thread";

type Props = {
  task: Task;
  pack?: Package;
  sprint?: Sprint;
  subIssues: Task[];
  comments: TaskComment[];
  blockers: TaskBlocker[];
  profiles: Profile[];
  sprints: Sprint[];
  milestones: Milestone[];
  source: "seed" | "supabase";
};

type EditableTaskState = Pick<Task, "status" | "priority" | "owner" | "sprintId" | "milestoneId" | "dependsOn" | "evidenceLink" | "problemStatement" | "intendedOutcome" | "scopeConstraints" | "acceptanceCriteria" | "evidenceRequired" | "definitionOfDone">;

function formatDate(value: string) {
  if (!value) return "ohne Datum";
  return new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value));
}

function dateRange(task: Task) {
  if (!task.startDate && !task.endDate) return task.deadline || "ohne Datum";
  if (task.startDate === task.endDate) return formatDate(task.startDate);
  return `${formatDate(task.startDate)} - ${formatDate(task.endDate)}`;
}

export function TaskDetailPage({
  task,
  pack,
  sprint,
  subIssues,
  comments,
  blockers,
  profiles,
  sprints,
  milestones,
  source,
}: Props) {
  const [taskComments, setTaskComments] = useState(comments);
  const [meta, setMeta] = useState<EditableTaskState>({
    status: normalizeStatus(task.status),
    priority: task.priority,
    owner: task.owner,
    sprintId: task.sprintId,
    milestoneId: task.milestoneId || "",
    dependsOn: task.dependsOn,
    evidenceLink: task.evidenceLink || task.issueUrl,
    problemStatement: task.problemStatement || task.description,
    intendedOutcome: task.intendedOutcome || "",
    scopeConstraints: task.scopeConstraints || "",
    acceptanceCriteria: task.acceptanceCriteria || "",
    evidenceRequired: task.evidenceRequired || "",
    definitionOfDone: task.definitionOfDone || "",
  });
  const [error, setError] = useState("");
  const [saveState, setSaveState] = useState("");
  const [isPending, startTransition] = useTransition();
  const ownerProfile = profiles.find((profile) => profile.name === meta.owner || profile.id === meta.owner);
  const currentSprint = sprints.find((item) => item.id === meta.sprintId) || sprint;
  const currentMilestone = milestones.find((item) => item.id === meta.milestoneId);
  const profileName = (profileId: string) => profiles.find((profile) => profile.id === profileId)?.name || profileId || "Unbekannt";
  const openBlockers = blockers.filter((blocker) => blocker.status === "open");

  const updateTask = (patch: Partial<EditableTaskState>) => {
    const next = { ...meta, ...patch };
    setMeta(next);
    setError("");
    setSaveState("Speichert...");

    if (source !== "supabase") {
      setSaveState("Lokal geändert");
      return;
    }

    startTransition(async () => {
      const session = await getBrowserSupabase()?.auth.getSession();
      const token = session?.data.session?.access_token;

      try {
        const response = await fetch(`/api/tasks/${task.id}`, {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(patch),
        });
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        if (!response.ok) throw new Error(body?.error || "Änderung konnte nicht gespeichert werden.");
        setSaveState("Gespeichert");
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Änderung konnte nicht gespeichert werden.");
        setSaveState("");
      }
    });
  };

  const addComment = (comment: string) => {
    setError("");

    if (source !== "supabase") {
      setTaskComments((current) => [
        {
          id: Date.now(),
          taskId: task.id,
          profileId: profiles[0]?.id || "",
          comment,
          createdAt: new Date().toISOString(),
        },
        ...current,
      ]);
      return;
    }

    startTransition(async () => {
      const session = await getBrowserSupabase()?.auth.getSession();
      const token = session?.data.session?.access_token;

      try {
        const response = await fetch(`/api/tasks/${task.id}/comments`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ comment }),
        });

        const body = (await response.json().catch(() => null)) as { error?: string; comment?: PlanningData["taskComments"][number] } | null;
        if (!response.ok || !body?.comment) throw new Error(body?.error || "Kommentar konnte nicht gespeichert werden.");
        setTaskComments((current) => [body.comment!, ...current]);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Kommentar konnte nicht gespeichert werden.");
      }
    });
  };

  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-6 py-4">
          <div>
            <Link href="/" className="inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-blue-700">
              <ArrowLeft size={16} />
              Zur Planung
            </Link>
            <div className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Aufgabendetail</div>
            <h1 className="mt-1 max-w-4xl text-2xl font-semibold tracking-tight text-slate-950">{task.title}</h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusTone(normalizeStatus(meta.status))}`}>{normalizeStatus(meta.status)}</span>
            <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${priorityTone(meta.priority)}`}>{meta.priority}</span>
            <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600">{task.hours}h</span>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl gap-5 px-6 py-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="grid gap-5">
          <section className="rounded-lg border border-slate-200 bg-white p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-slate-950">Aufgabenbrief</h2>
              <span className="rounded-full border border-blue-100 bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700">{task.dodTemplateVersion || "founder-deliverable-v2"}</span>
            </div>
            {[
              ["Problem Statement", "problemStatement", "Welches Problem löst diese Aufgabe?"],
              ["Intended Outcome", "intendedOutcome", "Welcher fertige Zustand soll erreicht sein?"],
              ["Scope & Constraints", "scopeConstraints", "Was gehört dazu, was nicht?"],
              ["Acceptance Criteria", "acceptanceCriteria", "Ein messbares Kriterium pro Zeile."],
              ["Evidence Required", "evidenceRequired", "Welcher Nachweis wird erwartet?"],
              ["Definition of Done", "definitionOfDone", "Allgemeiner Qualitätsstandard oder DoD-Snapshot."],
            ].map(([label, key, placeholder]) => (
              <label key={key} className="mt-4 grid gap-2 text-sm">
                <span className="font-semibold text-slate-950">{label}</span>
                <textarea
                  value={String(meta[key as keyof EditableTaskState] || "")}
                  onChange={(event) => setMeta((current) => ({ ...current, [key]: event.target.value }))}
                  onBlur={() => updateTask({ [key]: meta[key as keyof EditableTaskState] } as Partial<EditableTaskState>)}
                  className="min-h-20 w-full resize-y rounded-md border border-slate-200 p-3 text-sm leading-6 text-slate-800 outline-none focus:border-blue-400"
                  placeholder={placeholder}
                />
              </label>
            ))}

            <div className="mt-5 grid gap-4 border-t border-slate-100 pt-5">
              <div>
                <h3 className="text-sm font-semibold text-slate-950">Evidence Link</h3>
                <input
                  value={meta.evidenceLink}
                  onChange={(event) => setMeta((current) => ({ ...current, evidenceLink: event.target.value }))}
                  onBlur={() => updateTask({ evidenceLink: meta.evidenceLink })}
                  className="mt-2 h-9 w-full rounded-md border border-slate-200 px-3 text-sm outline-none focus:border-blue-400"
                  placeholder="Notion, Drive, GitHub oder Evidence-Link"
                />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-slate-950">Relationships</h3>
                <textarea
                  value={meta.dependsOn}
                  onChange={(event) => setMeta((current) => ({ ...current, dependsOn: event.target.value }))}
                  onBlur={() => updateTask({ dependsOn: meta.dependsOn })}
                  className="mt-2 min-h-20 w-full resize-y rounded-md border border-slate-200 p-3 text-sm leading-6 outline-none focus:border-blue-400"
                  placeholder="Wartet auf, blockiert durch oder verknüpfte Aufgaben"
                />
              </div>
            </div>
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-5">
            <h2 className="text-sm font-semibold text-slate-950">Sub-Issues</h2>
            <div className="mt-3 grid gap-2">
              {subIssues.map((item) => (
                <article key={item.id} className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2 text-sm">
                  <div className="font-semibold text-slate-800">{item.title}</div>
                  <div className="mt-1 text-xs text-slate-500">{normalizeStatus(item.status)} · {item.owner} · nicht score-relevant</div>
                </article>
              ))}
              {!subIssues.length && <div className="rounded-md border border-dashed border-slate-200 px-3 py-4 text-center text-sm text-slate-500">Noch keine Sub-Issues.</div>}
            </div>
          </section>

          <TaskCommentThread
            comments={taskComments}
            profiles={profiles}
            pending={isPending}
            title="Kommentare"
            description="Laufende Abstimmungen, Nachfragen und Updates zur Aufgabe."
            onAddComment={addComment}
          />
          {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div>}
        </div>

        <aside className="grid content-start gap-5">
          <section className="rounded-lg border border-slate-200 bg-white p-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-slate-950">Details</h2>
              <span className="text-xs text-slate-500">{isPending ? "Speichert..." : saveState}</span>
            </div>
            <div className="mt-3 grid gap-3 text-sm">
              <label className="grid gap-1 text-xs font-semibold text-slate-500">
                Status
                <select value={normalizeStatus(meta.status)} onChange={(event) => updateTask({ status: event.target.value as TaskStatus })} className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm font-normal text-slate-800">
                  {taskStatuses.map((status) => <option key={status}>{status}</option>)}
                </select>
              </label>
              <label className="grid gap-1 text-xs font-semibold text-slate-500">
                Owner
                <select value={meta.owner} onChange={(event) => updateTask({ owner: event.target.value })} className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm font-normal text-slate-800">
                  {profiles.map((profile) => <option key={profile.id} value={profile.name}>{profile.name}</option>)}
                </select>
              </label>
              <label className="grid gap-1 text-xs font-semibold text-slate-500">
                Priorität
                <select value={meta.priority} onChange={(event) => updateTask({ priority: event.target.value })} className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm font-normal text-slate-800">
                  {["P0", "P1", "P2", "P3", "P4"].map((priority) => <option key={priority}>{priority}</option>)}
                </select>
              </label>
              <div className="border-t border-slate-100 pt-3">
                <div className="text-xs font-semibold text-slate-500">Paket</div>
                <div className="mt-1 text-sm font-semibold text-slate-800">{pack ? `${pack.id} · ${pack.title}` : "ohne Paket"}</div>
              </div>
              <label className="grid gap-1 border-t border-slate-100 pt-3 text-xs font-semibold text-slate-500">
                Sprint
                <select value={meta.sprintId} onChange={(event) => updateTask({ sprintId: event.target.value })} className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm font-normal text-slate-800">
                  {sprints.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </label>
              <label className="grid gap-1 text-xs font-semibold text-slate-500">
                Meilenstein
                <select value={meta.milestoneId || ""} onChange={(event) => updateTask({ milestoneId: event.target.value })} className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm font-normal text-slate-800">
                  <option value="">Kein Meilenstein</option>
                  {milestones.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
                </select>
              </label>
              <div className="border-t border-slate-100 pt-3">
                <div className="text-xs font-semibold text-slate-500">Zeitraum</div>
                <div className="mt-1 flex items-center gap-2 text-sm font-semibold text-slate-800"><CalendarDays size={15} />{dateRange(task)}</div>
              </div>
              <div className="border-t border-slate-100 pt-3">
                <div className="text-xs font-semibold text-slate-500">Review</div>
                <div className="mt-1 text-sm font-semibold text-slate-800">{reviewLabel(task.reviewStatus)}</div>
              </div>
              <div>
                <div className="text-xs font-semibold text-slate-500">Score</div>
                <div className="mt-1 text-sm font-semibold text-slate-800">{task.scoreFinal ? `${task.scorePoints} final` : `${task.scorePoints} offen`}</div>
              </div>
              <div className="border-t border-slate-100 pt-3">
                <div className="text-xs font-semibold text-slate-500">Assignee</div>
                <div className="mt-1 text-sm font-semibold text-slate-800">{ownerProfile?.githubLogin || ownerProfile?.name || meta.owner}</div>
              </div>
              <div>
                <div className="text-xs font-semibold text-slate-500">Milestone-Ziel</div>
                <div className="mt-1 text-sm text-slate-700">{currentMilestone?.targetDate ? formatDate(currentMilestone.targetDate) : "Kein Zieltermin"}</div>
              </div>
              <div>
                <div className="text-xs font-semibold text-slate-500">Sprint-Zeitraum</div>
                <div className="mt-1 text-sm text-slate-700">{currentSprint ? `${formatDate(currentSprint.startDate)} bis ${formatDate(currentSprint.endDate)}` : "Kein Sprint"}</div>
              </div>
            </div>
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-5">
            <h2 className="text-sm font-semibold text-slate-950">Blocker</h2>
            <div className="mt-2 text-sm text-slate-600">{openBlockers.length} offen</div>
            <div className="mt-3 grid gap-2">
              {blockers.map((blocker) => (
                <article key={blocker.id} className="rounded-md border border-orange-100 bg-orange-50 px-3 py-2 text-xs text-orange-950">
                  <div className="font-semibold">{profileName(blocker.profileId)} · {blocker.status}</div>
                  <p className="mt-1 leading-5">{blocker.reason}</p>
                </article>
              ))}
              {!blockers.length && <div className="text-sm text-slate-500">Keine Blocker gemeldet.</div>}
            </div>
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-950">
              <GitBranch size={16} />
              GitHub Sync
            </h2>
            <div className="mt-3 grid gap-2 text-sm leading-6 text-slate-600">
              <p>{task.githubRepo || "findmydoc-platform/management"} · {syncLabel(task.githubSyncStatus)}</p>
              {task.githubIssueUrl ? (
                <a href={task.githubIssueUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-blue-700 hover:underline">
                  <Link2 size={14} />
                  GitHub-Issue öffnen
                </a>
              ) : (
                <p>Noch kein GitHub-Issue gespiegelt.</p>
              )}
              {task.githubSyncError && <p className="flex gap-2 text-red-700"><MessageSquareWarning size={16} />{task.githubSyncError}</p>}
            </div>
          </section>
        </aside>
      </div>
    </main>
  );
}

