"use client";

import { Lock } from "lucide-react";
import { useEffect, useState } from "react";
import { CustomSelect } from "@/shared/atoms/custom-select";
import { UiBadge, UiButton, UiNotice, UiPanel } from "@/shared/atoms/ui-primitives";
import { formatDate } from "@/lib/display";
import type { PlanningShellState, Sprint, Task } from "@/lib/types";

export function SprintControlsSummary({
  data,
  planningState,
  sprint,
  currentSprint,
  sprintTasks,
  reviewTasksCount,
  finalScores,
  openScores,
  unassignedTasksCount,
  sprintHasTasks,
  sprintIsCurrent,
  sprintControlsDisabled,
  canFinalizeSprintScore,
  sprintLockMessage,
  openObjectionsCount,
  onSelectedSprintChange,
  onLockSprint,
}: {
  data: PlanningShellState;
  planningState: import("@/features/planning/model/planning-state").PlanningState;
  sprint: Sprint;
  currentSprint?: Sprint;
  sprintTasks: Task[];
  reviewTasksCount: number;
  finalScores: number;
  openScores: number;
  unassignedTasksCount: number;
  sprintHasTasks: boolean;
  sprintIsCurrent: boolean;
  sprintControlsDisabled: boolean;
  canFinalizeSprintScore: boolean;
  sprintLockMessage: string;
  openObjectionsCount: number;
  onSelectedSprintChange: (sprintId: string) => void;
  onLockSprint: (sprintId: string) => void;
}) {
  const provisionalIds = planningState.sprintPlan().provisionalSprintIds;
  const provisional = provisionalIds.includes(sprint.id);
  const [editor, setEditor] = useState<import("../model/sprint-editing").SprintEditor | null>(null);
  useEffect(() => () => editor?.close(), [editor]);
  const currentEdit = editor?.view() || planningState.sprintEdits(sprint.id).findLast(edit => ["unconfirmed", "blocked", "conflict"].includes(edit.phase));
  const editBlocked = currentEdit && ["saving", "unconfirmed", "blocked", "conflict"].includes(currentEdit.phase);
  const [checkMessage, setCheckMessage] = useState("");
  const [renderedAt] = useState(() => Date.now());
  const reviewDueLabel = sprint.reviewDueAt
    ? new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(sprint.reviewDueAt))
    : "ohne Datum";
  const reviewWindowOpen = Boolean(sprint.reviewDueAt && new Date(sprint.reviewDueAt).getTime() > renderedAt);
  const lockBlocked = provisional || sprintControlsDisabled || !canFinalizeSprintScore || sprint.scoreLocked || reviewWindowOpen || openObjectionsCount > 0;
  const lockTitle = !canFinalizeSprintScore
    ? "Nur der CEO kann Sprint-Scores finalisieren."
    : reviewWindowOpen
      ? `Finalisierung erst nach der Review- und Einwandfrist am ${reviewDueLabel}.`
      : openObjectionsCount > 0
        ? "Offene Score-Einwände müssen zuerst abgeschlossen werden."
        : undefined;
  const summaryItems = [
    { label: "Aufgaben", value: sprintTasks.length },
    { label: "Review", value: reviewTasksCount },
    { label: "Scores final", value: `${finalScores}/${sprintTasks.length}` },
    { label: "Scores offen", value: openScores },
    { label: "Ohne Sprint", value: unassignedTasksCount },
  ];

  return (
    <UiPanel padding="none" className="min-w-0">
      <div className="flex flex-wrap items-end justify-between gap-3 p-4">
        <div className="flex min-w-0 flex-wrap items-end gap-2">
          <label className="grid min-w-56 gap-1 text-xs font-semibold text-slate-500">
            Sprint
            <CustomSelect
              value={sprint.id}
              onChange={onSelectedSprintChange}
              className="h-9 text-sm"
              options={data.sprints.map((item) => ({
                value: item.id,
                label: `${item.name}${provisionalIds.includes(item.id) ? " (unbestätigt)" : ""}`,
                current: currentSprint?.id === item.id,
                locked: data.tasks.some((task) => task.sprintId === item.id),
              }))}
            />
          </label>
          {sprintIsCurrent && (
            <span
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-emerald-200 bg-emerald-50 text-emerald-600"
              aria-label="Aktueller Sprint"
              title="Aktueller Sprint"
            >
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 shadow-[0_0_0_4px_rgba(16,185,129,0.16)]" />
            </span>
          )}
          {sprintHasTasks && (
            <UiBadge
              size="xs"
              className="h-9 gap-1.5"
              aria-label={`${sprintTasks.length} verknüpfte Aufgaben, Zeitraum geschützt`}
              title={`${sprintTasks.length} verknüpfte Aufgaben, Zeitraum geschützt`}
            >
              <Lock size={13} />
              {sprintTasks.length}
            </UiBadge>
          )}
          <div className="flex h-9 items-center rounded-md border border-slate-200 bg-slate-50 px-3 text-xs font-semibold text-slate-600">
            {formatDate(sprint.startDate)} - {formatDate(sprint.endDate)}
          </div>
          <div className="flex h-9 items-center rounded-md border border-slate-200 bg-slate-50 px-3 text-xs font-semibold text-slate-600">
            Review bis {reviewDueLabel}
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="grid min-w-36 gap-1 text-xs font-semibold text-slate-500">
            Status
            <CustomSelect
              value={currentEdit?.submitted?.status && editBlocked ? currentEdit.submitted.status : sprint.status}
              disabled={provisional || sprintControlsDisabled || sprint.scoreLocked || Boolean(editBlocked)}
              onOpen={() => { editor?.close(); setEditor(planningState.beginSprintEdit(sprint)); }}
              onChange={(value) => { const active = editor || planningState.beginSprintEdit(sprint); setEditor(active); void active.save({ status: value as Sprint["status"] }); }}
              className="h-9 text-sm"
              options={[
                { value: "planning", label: "Planung" },
                { value: "active", label: "Aktiv" },
                { value: "review", label: "Review" },
                { value: "closed", label: "Abgeschlossen" },
              ]}
            />
          </label>
          <UiButton
            type="button"
            disabled={lockBlocked}
            title={lockTitle}
            onClick={() => onLockSprint(sprint.id)}
            className="h-9"
          >
            Sprint abschließen
          </UiButton>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 border-t border-slate-100 px-4 py-3">
        {summaryItems.map((item) => (
          <span key={item.label} className="inline-flex h-8 items-center gap-2 rounded-md bg-slate-50 px-3 text-xs font-semibold text-slate-600">
            <span className="text-slate-950">{item.value}</span>
            {item.label}
          </span>
        ))}
      </div>
      {currentEdit && ["conflict", "unconfirmed", "blocked", "rejected"].includes(currentEdit.phase) && <UiNotice tone="warning" className="m-3" role="status">
        <p className="font-semibold">{currentEdit.phase === "conflict" ? "Sprint wurde zwischenzeitlich geändert" : currentEdit.phase === "rejected" ? "Sprint-Änderung abgelehnt" : "Sprint-Änderung noch nicht bestätigt"}</p>
        <p>{currentEdit.error}</p>
        {currentEdit.submitted && <p>Eingabe: {Object.entries(currentEdit.submitted).map(([key, value]) => `${key}: ${value}`).join(", ")}</p>}
        {currentEdit.serverSprint && <p>Serverstatus: {currentEdit.serverSprint.status}</p>}
        {currentEdit.phase === "conflict" && <div className="mt-2 flex flex-wrap gap-2">
          <UiButton className="min-h-11" onClick={() => { void editor?.refreshConflict(); }}>Serverstand vergleichen</UiButton>
          <UiButton className="min-h-11" disabled={!currentEdit.canResave || !currentEdit.submitted} onClick={() => { if (currentEdit.submitted) void editor?.resave(currentEdit.submitted); }}>Bewusst erneut speichern</UiButton>
        </div>}
        {["unconfirmed", "blocked"].includes(currentEdit.phase) && <UiButton className="mt-2 min-h-11" onClick={async () => { const result = await planningState.checkSprintSave(sprint.id); setCheckMessage(result.readStatus === "forbidden" ? "Kein Zugriff auf diesen Sprint-Bereich." : result.outcome === "not-pending" ? "Der Entwurf wurde noch nicht gesendet. Du kannst den Status jetzt bewusst wählen." : "Serverstand geprüft. Die Speicherung bleibt unbestätigt; sie wurde nicht erneut gesendet."); }}>Serverstand prüfen</UiButton>}
        {checkMessage && <p>{checkMessage}</p>}
      </UiNotice>}
      {sprintLockMessage && (
        <UiNotice tone="info" radius="none" className="!border-x-0 !border-b-0 border-t-blue-100 px-4 py-3 font-medium">
          {sprintLockMessage}
        </UiNotice>
      )}
      {openObjectionsCount > 0 && (
        <UiNotice tone="warning" radius="none" className="!border-x-0 !border-b-0 border-t-amber-100 px-4 py-3 font-medium">
          {openObjectionsCount} offener Score-Einwand blockiert den Sprint-Lock bis zur Prüfung.
        </UiNotice>
      )}
      {!sprint.scoreLocked && reviewWindowOpen && (
        <UiNotice tone="info" radius="none" className="!border-x-0 !border-b-0 border-t-blue-100 px-4 py-3 font-medium">
          Score-Finalisierung ist nach dem {reviewDueLabel} möglich.
        </UiNotice>
      )}
    </UiPanel>
  );
}
