"use client";

import { AlertTriangle, Lock } from "lucide-react";
import { useEffect, useState } from "react";
import { CustomSelect } from "@/components/custom-select";
import { SprintMeetingAttendanceSection } from "@/components/sprint-meeting-attendance-section";
import { GitHubMissingBadge } from "@/components/task-card";
import { dateRange, formatDate, taskOwnerLabel } from "@/lib/display";
import { hasGitHubIssue, reviewLabel, roleLabel } from "@/lib/platform";
import { buildSprintScoreViewModel, findCurrentSprint, reviewChecklistItems, reviewChecklistScore } from "@/lib/sprint-score-view-model";
import { normalizeStatus, statusTone, taskStatuses } from "@/lib/status";
import type { CommitmentLevel, Meeting, MeetingAttendance, PlanningData, Profile, Sprint, SprintCommitment, Task, TaskStatus } from "@/lib/types";

export function SprintScoreTableOverview({
  data,
  pending,
  onOpen,
  onReview,
  onRequestReview,
  onChangeStatus,
  onLockSprint,
  onUpdateSprint,
  onUpdateCommitment,
  onUpdateMeetingAttendance,
  onAssignSprint,
  currentProfile,
  canManageSprint,
  sprintLockMessage,
}: {
  data: PlanningData;
  pending: boolean;
  onOpen: (task: Task) => void;
  onReview: (
    task: Task,
    reviewStatus: "accepted" | "partial" | "changes_requested",
    scorePoints: number,
    checklist?: { acceptanceCriteriaMet?: boolean; dodMet?: boolean; evidenceProvided?: boolean; communicationClear?: boolean; blockerHandled?: boolean },
    comment?: string,
  ) => void;
  onRequestReview: (task: Task) => void;
  onChangeStatus: (task: Task, status: TaskStatus) => void;
  onLockSprint: (sprintId: string) => void;
  onUpdateSprint: (sprint: Sprint, patch: Partial<Sprint>) => void;
  onUpdateCommitment: (commitment: SprintCommitment) => void;
  onUpdateMeetingAttendance: (meeting: Meeting, attendance: MeetingAttendance) => void;
  onAssignSprint: (task: Task, sprintId: string) => void;
  currentProfile: Profile | null;
  canManageSprint: boolean;
  sprintLockMessage: string;
}) {
  const currentSprint = findCurrentSprint(data.sprints);
  const [selectedSprintId, setSelectedSprintId] = useState(currentSprint?.id || "");
  const [selectedReviewTaskId, setSelectedReviewTaskId] = useState("");
  const [reviewComment, setReviewComment] = useState("");
  const [reviewChecklist, setReviewChecklist] = useState({
    acceptanceCriteriaMet: false,
    evidenceProvided: false,
    communicationClear: false,
    blockerHandled: false,
  });
  const reviewScore = reviewChecklistScore(reviewChecklist);
  useEffect(() => {
    if (!data.sprints.length) return;
    if (!selectedSprintId || !data.sprints.some((item) => item.id === selectedSprintId)) {
      const nextSprintId = findCurrentSprint(data.sprints)?.id || data.sprints[0]?.id || "";
      window.queueMicrotask(() => setSelectedSprintId(nextSprintId));
    }
  }, [data.sprints, selectedSprintId]);

  const {
    sprint,
    sprintTasks,
    otherTasks,
    unassignedTasks,
    scoreRows,
    reviewTasks,
    meeting,
    finalScores,
    openScores,
    sprintHasTasks,
    sprintIsCurrent,
  } = buildSprintScoreViewModel({ data, selectedSprintId });
  const selectedReviewTask = reviewTasks.find((task) => task.id === selectedReviewTaskId) || reviewTasks[0];
  const sprintControlsDisabled = pending || !canManageSprint;
  const sprintStatusLabel: Record<Sprint["status"], string> = {
    planning: "Planung",
    active: "Aktiv",
    review: "Review",
    closed: "Abgeschlossen",
  };

  if (!sprint) {
    return (
      <section className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
        Noch kein Sprint angelegt. Nach der nächsten Migration erscheint hier die Sprint-Tabelle.
      </section>
    );
  }

  return (
    <div className="grid gap-4">
      <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="grid gap-3 border-b border-slate-100 p-4 xl:grid-cols-[minmax(220px,1.3fr)_repeat(4,minmax(150px,1fr))_auto] xl:items-end">
          <label className="grid gap-1 text-xs font-semibold text-slate-500">
            Sprint
            <CustomSelect
              value={sprint.id}
              onChange={setSelectedSprintId}
              className="h-9 text-sm"
              options={data.sprints.map((item) => ({
                value: item.id,
                label: item.name,
                current: currentSprint?.id === item.id,
                locked: data.tasks.some((task) => task.sprintId === item.id),
              }))}
            />
          </label>
          <div className="grid gap-1 text-xs font-semibold text-slate-500">
            Start
            <div className="flex h-9 items-center rounded-md border border-slate-200 bg-slate-50 px-2 text-sm font-semibold text-slate-900">{formatDate(sprint.startDate)}</div>
          </div>
          <div className="grid gap-1 text-xs font-semibold text-slate-500">
            Ende
            <div className="flex h-9 items-center rounded-md border border-slate-200 bg-slate-50 px-2 text-sm font-semibold text-slate-900">{formatDate(sprint.endDate)}</div>
          </div>
          <div className="grid gap-1 text-xs font-semibold text-slate-500">
            Review bis
            <div className="flex h-9 items-center rounded-md border border-slate-200 bg-slate-50 px-2 text-sm font-semibold text-slate-900">
              {sprint.reviewDueAt ? new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(sprint.reviewDueAt)) : "ohne Datum"}
            </div>
          </div>
          <label className="grid gap-1 text-xs font-semibold text-slate-500">
            Status
            <CustomSelect
              value={sprint.status}
              disabled={sprintControlsDisabled || sprint.scoreLocked}
              onChange={(value) => onUpdateSprint(sprint, { status: value as Sprint["status"] })}
              className="h-9 text-sm"
              options={[
                { value: "planning", label: "Planung" },
                { value: "active", label: "Aktiv" },
                { value: "review", label: "Review" },
                { value: "closed", label: "Abgeschlossen" },
              ]}
            />
          </label>
          <button
            type="button"
            disabled={sprintControlsDisabled || sprint.scoreLocked}
            onClick={() => onLockSprint(sprint.id)}
            className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Sprint abschließen
          </button>
        </div>
        <div className="grid gap-3 px-4 py-3 text-sm text-slate-600 sm:grid-cols-2 xl:grid-cols-5">
          <div><span className="font-semibold text-slate-950">{sprintTasks.length}</span> Aufgaben im Sprint</div>
          <div><span className="font-semibold text-slate-950">{reviewTasks.length}</span> im Review</div>
          <div><span className="font-semibold text-slate-950">{finalScores}/{sprintTasks.length}</span> Scores final</div>
          <div><span className="font-semibold text-slate-950">{openScores}</span> Scores offen</div>
          <div><span className="font-semibold text-slate-950">{unassignedTasks.length}</span> ohne Sprint</div>
        </div>
        <div className="flex flex-wrap gap-2 border-t border-slate-100 px-4 py-3">
          {sprintIsCurrent && (
            <span
              className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-emerald-200 bg-emerald-50 text-emerald-600"
              aria-label="Aktueller Sprint"
              title="Aktueller Sprint"
            >
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 shadow-[0_0_0_4px_rgba(16,185,129,0.16)]" />
            </span>
          )}
          {sprintHasTasks && (
            <span
              className="inline-flex h-7 items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2 text-xs font-semibold text-slate-600"
              aria-label={`${sprintTasks.length} verknüpfte Aufgaben, Zeitraum geschützt`}
              title={`${sprintTasks.length} verknüpfte Aufgaben, Zeitraum geschützt`}
            >
              <Lock size={13} />
              {sprintTasks.length}
            </span>
          )}
        </div>
        {sprintLockMessage && (
          <div className="border-t border-blue-100 bg-blue-50 px-4 py-3 text-sm font-medium text-blue-800">
            {sprintLockMessage}
          </div>
        )}
      </section>

      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <div>
            <h2 className="text-base font-semibold text-slate-950">Founder Scoreboard</h2>
            <p className="text-xs text-slate-500">{sprintStatusLabel[sprint.status]} · {formatDate(sprint.startDate)} bis {formatDate(sprint.endDate)}</p>
          </div>
          <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${sprint.scoreLocked ? "border-blue-200 bg-blue-50 text-blue-700" : "border-amber-200 bg-amber-50 text-amber-700"}`}>
            {sprint.scoreLocked ? "Score gelockt" : "Score offen"}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[980px] w-full border-separate border-spacing-0 text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="border-b border-slate-200 px-4 py-3 font-semibold">Founder</th>
                <th className="border-b border-slate-200 px-3 py-3 font-semibold">Aufgaben</th>
                <th className="border-b border-slate-200 px-3 py-3 font-semibold">Wochenstunden</th>
                <th className="border-b border-slate-200 px-3 py-3 font-semibold">Commitment</th>
                <th className="border-b border-slate-200 px-3 py-3 font-semibold">Workflow</th>
                <th className="border-b border-slate-200 px-3 py-3 font-semibold">Review</th>
                <th className="border-b border-slate-200 px-3 py-3 font-semibold">Final</th>
                <th className="border-b border-slate-200 px-3 py-3 font-semibold">Punkte</th>
                <th className="border-b border-slate-200 px-3 py-3 font-semibold">Offen</th>
                <th className="border-b border-slate-200 px-3 py-3 font-semibold">Aufwand</th>
              </tr>
            </thead>
            <tbody>
              {scoreRows.map((row) => (
                <tr key={row.profile.id} className="hover:bg-slate-50">
                  <td className="border-b border-slate-100 px-4 py-3">
                    <div className="font-semibold text-slate-950">{row.profile.name}</div>
                    <div className="text-xs text-slate-500">{roleLabel(row.profile)}</div>
                  </td>
                  <td className="border-b border-slate-100 px-3 py-3">
                    <CustomSelect value={row.commitment.commitmentLevel} disabled={pending || sprint.scoreLocked} onChange={(value) => onUpdateCommitment({ ...row.commitment, commitmentLevel: value as CommitmentLevel })} className="h-8 w-28 text-xs" options={["Lite", "Standard", "Heavy", "Away"].map((level) => ({ value: level, label: level }))} />
                  </td>
                  <td className="border-b border-slate-100 px-3 py-3">
                    <input
                      type="number"
                      min={0}
                      max={80}
                      value={row.commitment.weeklyHours}
                      disabled={pending || sprint.scoreLocked}
                      onChange={(event) => onUpdateCommitment({ ...row.commitment, weeklyHours: Number(event.target.value) })}
                      className="h-8 w-20 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700 disabled:bg-slate-50 disabled:opacity-60"
                    />
                  </td>
                  <td className="border-b border-slate-100 px-3 py-3 font-semibold text-slate-900">{row.committed}</td>
                  <td className="border-b border-slate-100 px-3 py-3 text-slate-700">{row.active} aktiv · {row.blocked} blockiert</td>
                  <td className="border-b border-slate-100 px-3 py-3 text-slate-700">{row.reviewReady}</td>
                  <td className="border-b border-slate-100 px-3 py-3 text-slate-700">{row.finalScore}</td>
                  <td className="border-b border-slate-100 px-3 py-3 text-lg font-semibold text-slate-950">{row.finalPoints}</td>
                  <td className="border-b border-slate-100 px-3 py-3 text-slate-700">{row.openScore}</td>
                  <td className="border-b border-slate-100 px-3 py-3 text-slate-700">{row.hours}h</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <SprintMeetingAttendanceSection
        data={data}
        meeting={meeting}
        pending={pending}
        currentProfile={currentProfile}
        canManageSprint={canManageSprint}
        onUpdateMeetingAttendance={onUpdateMeetingAttendance}
      />

      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-4 py-3">
          <h2 className="text-base font-semibold text-slate-950">Sprint-Aufgaben</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[1180px] w-full border-separate border-spacing-0 text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="border-b border-slate-200 px-4 py-3 font-semibold">Aufgabe</th>
                <th className="border-b border-slate-200 px-3 py-3 font-semibold">Assignee</th>
                <th className="border-b border-slate-200 px-3 py-3 font-semibold">Status</th>
                <th className="border-b border-slate-200 px-3 py-3 font-semibold">Review-Status</th>
                <th className="border-b border-slate-200 px-3 py-3 font-semibold">CEO-Score</th>
                <th className="border-b border-slate-200 px-3 py-3 font-semibold">Sprint</th>
                <th className="border-b border-slate-200 px-3 py-3 font-semibold">Zeitraum</th>
                <th className="border-b border-slate-200 px-3 py-3 font-semibold">Nächster Schritt</th>
              </tr>
            </thead>
            <tbody>
              {sprintTasks.map((task) => (
                <tr key={task.id} className="hover:bg-slate-50">
                  <td className="max-w-[360px] border-b border-slate-100 px-4 py-3">
                    <button type="button" onClick={() => onOpen(task)} className="flex max-w-full items-start gap-1.5 truncate text-left font-semibold text-slate-950 hover:text-blue-700">
                      {!hasGitHubIssue(task) && <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-500" aria-hidden="true" />}
                      <span className="truncate">{task.title}</span>
                    </button>
                    <div className="mt-1 truncate text-xs text-slate-500">{task.workstream} · {task.priority} · {task.hours}h</div>
                    {(!hasGitHubIssue(task) || task.carriedFromSprintId || task.sprintOutcome) && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {!hasGitHubIssue(task) && <GitHubMissingBadge />}
                        {task.carriedFromSprintId && <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700">Carry-over</span>}
                        {task.sprintOutcome && <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-600">{task.sprintOutcome}</span>}
                      </div>
                    )}
                  </td>
                  <td className="border-b border-slate-100 px-3 py-3 text-slate-700">{taskOwnerLabel(task)}</td>
                  <td className="border-b border-slate-100 px-3 py-3">
                    <CustomSelect value={normalizeStatus(task.status)} disabled={pending} onChange={(value) => onChangeStatus(task, value as TaskStatus)} className={`h-8 w-32 text-xs font-semibold ${statusTone(normalizeStatus(task.status))}`} options={taskStatuses.map((status) => ({ value: status, label: status }))} />
                  </td>
                  <td className="border-b border-slate-100 px-3 py-3 text-slate-700">{reviewLabel(task.reviewStatus)}</td>
                  <td className="border-b border-slate-100 px-3 py-3 text-slate-700">
                    {task.scorePoints} {task.scoreFinal ? "final" : "offen"}
                  </td>
                  <td className="border-b border-slate-100 px-3 py-3">
                    <CustomSelect value={task.sprintId} disabled={pending || sprint.scoreLocked} onChange={(value) => onAssignSprint(task, value)} className="h-8 w-44 text-xs" options={data.sprints.map((item) => ({ value: item.id, label: item.name }))} />
                  </td>
                  <td className="border-b border-slate-100 px-3 py-3 text-slate-700">{dateRange(task)}</td>
                  <td className="border-b border-slate-100 px-3 py-3">
                    <div className="flex flex-wrap gap-1.5">
                      {task.reviewStatus === "not_requested" || normalizeStatus(task.status) === "Nacharbeit" ? (
                        <button type="button" disabled={pending || sprint.scoreLocked} onClick={() => onRequestReview(task)} className="h-8 rounded-md border border-blue-200 bg-blue-50 px-2 text-xs font-semibold text-blue-700 disabled:cursor-not-allowed disabled:opacity-50">Review anfragen</button>
                      ) : null}
                      {task.reviewStatus !== "not_requested" || normalizeStatus(task.status) === "Review" ? (
                        <button
                          type="button"
                          disabled={pending || sprint.scoreLocked || task.scoreFinal}
                          onClick={() => {
                            setSelectedReviewTaskId(task.id);
                            setReviewComment("");
                            setReviewChecklist({ acceptanceCriteriaMet: false, evidenceProvided: false, communicationClear: false, blockerHandled: false });
                          }}
                          className="h-8 rounded-md border border-blue-200 bg-blue-50 px-2 text-xs font-semibold text-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Review-Blatt
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
              {!sprintTasks.length && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-sm text-slate-500">
                    Noch keine Aufgaben in diesem Sprint.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {selectedReviewTask && (
        <section className="rounded-lg border border-blue-200 bg-white shadow-sm">
          <div className="border-b border-blue-100 bg-blue-50 px-4 py-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-blue-700">CEO Review-Blatt</div>
            <h2 className="mt-1 text-base font-semibold text-slate-950">{selectedReviewTask.title}</h2>
            <p className="mt-1 text-xs text-slate-600">{selectedReviewTask.owner} · {selectedReviewTask.priority} · {selectedReviewTask.hours}h · {reviewLabel(selectedReviewTask.reviewStatus)}</p>
            <p className="mt-2 text-xs leading-5 text-blue-800">CEO-Punkte entstehen nur hier im Review-Blatt. Das Founder-Arbeitsblatt bleibt Arbeitsstand ohne Score.</p>
          </div>
          <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="grid gap-3">
              <div className="rounded-md border border-slate-100 bg-slate-50 p-3">
                <div className="text-xs font-semibold text-slate-500">Problem Statement</div>
                <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-700">{selectedReviewTask.problemStatement || selectedReviewTask.description || "Kein Problem Statement hinterlegt."}</p>
              </div>
              <div className="rounded-md border border-slate-100 bg-slate-50 p-3">
                <div className="text-xs font-semibold text-slate-500">Intended Outcome</div>
                <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-700">{selectedReviewTask.intendedOutcome || "Kein Intended Outcome hinterlegt."}</p>
              </div>
              <div className="rounded-md border border-slate-100 bg-slate-50 p-3">
                <div className="text-xs font-semibold text-slate-500">Acceptance Criteria</div>
                <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-700">{selectedReviewTask.acceptanceCriteria || selectedReviewTask.definitionOfDone || "Keine Acceptance Criteria hinterlegt."}</p>
              </div>
              <div className="rounded-md border border-slate-100 bg-slate-50 p-3">
                <div className="text-xs font-semibold text-slate-500">Definition of Done Snapshot</div>
                <p className="mt-1 text-sm leading-6 text-slate-700">{selectedReviewTask.definitionOfDone || "Keine Definition of Done hinterlegt."}</p>
              </div>
              <div className="rounded-md border border-slate-100 bg-slate-50 p-3">
                <div className="text-xs font-semibold text-slate-500">Evidence Required / Abhängigkeiten</div>
                <p className="mt-1 text-sm leading-6 text-slate-700">{selectedReviewTask.evidenceRequired || "Kein erwarteter Nachweis hinterlegt."}</p>
                <p className="mt-1 text-sm leading-6 text-slate-700">{selectedReviewTask.evidenceLink || selectedReviewTask.issueUrl || "Noch kein Evidence-Link hinterlegt."}</p>
                <p className="mt-1 text-sm leading-6 text-slate-700">{selectedReviewTask.dependsOn || "Keine harte Abhängigkeit erfasst."}</p>
              </div>
              <textarea
                value={reviewComment}
                onChange={(event) => setReviewComment(event.target.value)}
                className="min-h-24 w-full resize-y rounded-md border border-slate-200 p-3 text-sm leading-6 outline-none focus:border-blue-400"
                placeholder="Review-Kommentar oder Nacharbeit beschreiben"
              />
            </div>
            <div className="grid content-start gap-3">
              <div className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600">
                Punkteformel: vier CEO-Kriterien ergeben je 2,5 Punkte, gerundet auf 0 bis 10.
              </div>
              {reviewChecklistItems.map(([key, label, pointsLabel]) => (
                <label key={key} className="flex items-center justify-between gap-3 rounded-md border border-slate-100 px-3 py-2 text-sm text-slate-700">
                  <span>
                    <span className="block">{label}</span>
                    <span className="text-xs text-slate-500">{pointsLabel}</span>
                  </span>
                  <input
                    type="checkbox"
                    checked={Boolean(reviewChecklist[key as keyof typeof reviewChecklist])}
                    onChange={(event) => setReviewChecklist((current) => ({ ...current, [key]: event.target.checked }))}
                  />
                </label>
              ))}
              <label className="grid gap-1 text-xs font-semibold text-slate-500">
                Automatische CEO-Punkte
                <input
                  type="number"
                  min={0}
                  max={10}
                  value={reviewScore}
                  readOnly
                  className="h-9 rounded-md border border-slate-200 bg-slate-50 px-2 text-sm font-semibold text-slate-800"
                />
                <span className="text-[11px] font-normal text-slate-500">Berechnet aus den abgehakten Review-Kriterien.</span>
              </label>
              <p className="text-[11px] leading-5 text-slate-500">
                Nacharbeit vergibt 0 finale Punkte und verschiebt die Aufgabe zurück in den Status Nacharbeit.
              </p>
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={pending || sprint.scoreLocked || selectedReviewTask.scoreFinal} onClick={() => onReview(selectedReviewTask, "accepted", reviewScore, reviewChecklist, reviewComment)} className="h-9 rounded-md border border-emerald-200 bg-emerald-50 px-3 text-sm font-semibold text-emerald-700 disabled:cursor-not-allowed disabled:opacity-50">Akzeptieren</button>
                <button type="button" disabled={pending || sprint.scoreLocked || selectedReviewTask.scoreFinal} onClick={() => onReview(selectedReviewTask, "partial", reviewScore, reviewChecklist, reviewComment)} className="h-9 rounded-md border border-amber-200 bg-amber-50 px-3 text-sm font-semibold text-amber-700 disabled:cursor-not-allowed disabled:opacity-50">Teilweise</button>
                <button type="button" disabled={pending || sprint.scoreLocked || selectedReviewTask.scoreFinal} onClick={() => onReview(selectedReviewTask, "changes_requested", 0, reviewChecklist, reviewComment)} className="h-9 rounded-md border border-orange-200 bg-orange-50 px-3 text-sm font-semibold text-orange-700 disabled:cursor-not-allowed disabled:opacity-50">Nacharbeit</button>
              </div>
            </div>
          </div>
        </section>
      )}

      {otherTasks.length > 0 && (
        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-4 py-3">
            <h2 className="text-base font-semibold text-slate-950">Backlog und andere Sprints</h2>
            <p className="text-xs text-slate-500">Nicht im ausgewählten Sprint.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-[840px] w-full border-separate border-spacing-0 text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="border-b border-slate-200 px-4 py-3 font-semibold">Aufgabe</th>
                  <th className="border-b border-slate-200 px-3 py-3 font-semibold">Assignee</th>
                  <th className="border-b border-slate-200 px-3 py-3 font-semibold">Aktueller Sprint</th>
                  <th className="border-b border-slate-200 px-3 py-3 font-semibold">Zuweisung</th>
                </tr>
              </thead>
              <tbody>
                {otherTasks.map((task) => {
                  const currentSprint = data.sprints.find((item) => item.id === task.sprintId);
                  return (
                    <tr key={task.id} className="hover:bg-slate-50">
                      <td className="max-w-[420px] border-b border-slate-100 px-4 py-3">
                        <button type="button" onClick={() => onOpen(task)} className="block truncate text-left font-semibold text-slate-950 hover:text-blue-700">
                          {task.title}
                        </button>
                        <div className="mt-1 truncate text-xs text-slate-500">{task.workstream} · {task.priority} · {task.hours}h</div>
                      </td>
                      <td className="border-b border-slate-100 px-3 py-3 text-slate-700">{taskOwnerLabel(task)}</td>
                      <td className="border-b border-slate-100 px-3 py-3 text-slate-700">{currentSprint?.name || "ohne Sprint"}</td>
                      <td className="border-b border-slate-100 px-3 py-3">
                        <CustomSelect value={task.sprintId} disabled={pending} onChange={(value) => onAssignSprint(task, value)} className="h-8 w-56 text-xs" options={data.sprints.map((item) => ({ value: item.id, label: item.name }))} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
