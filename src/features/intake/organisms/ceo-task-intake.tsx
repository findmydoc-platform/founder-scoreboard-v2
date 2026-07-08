"use client";

import { AlertTriangle, CheckCircle2, ClipboardList, WandSparkles } from "lucide-react";
import { useMemo, useState } from "react";
import { commitTaskIntake, previewTaskIntake, type TaskIntakeCommitResponse, type TaskIntakeResponse } from "@/features/intake/model/task-intake-api-client";
import type { BrowserApiClient } from "@/lib/browser-api-client";
import type { TaskIntakePreviewTask } from "@/lib/task-intake";
import type { Package, Profile, Sprint, Task } from "@/lib/types";
import { UiBadge, UiButton, UiNotice, UiPanel } from "@/shared/atoms/ui-primitives";

type Props = {
  source: "seed" | "supabase";
  profiles: Profile[];
  packages: Package[];
  sprints: Sprint[];
  apiClient: BrowserApiClient;
  onTasksCreated: (tasks: Task[]) => void;
};

const sampleTasks = {
  tasks: [
    {
      title: "Beispiel-Aufgabe aus CEO Intake",
      taskType: "deliverable",
      packageId: "initiative-id",
      sprintId: "sprint-2",
      assignee: "sebastian",
      priority: "P1",
      hours: 4,
      problemStatement: "Was ist aktuell unklar oder kaputt?",
      intendedOutcome: "Welches Ergebnis soll nach der Aufgabe sicher sichtbar sein?",
      acceptanceCriteria: [
        "Kriterium 1 ist erfüllt.",
        "Kriterium 2 ist mit Evidence belegbar.",
      ],
      evidenceRequired: "Link, Screenshot oder kurzer Nachweis.",
      definitionOfDone: "Die Aufgabe kann vom Review Owner nachvollziehbar abgenommen werden.",
    },
  ],
};

function previewState(tasks: TaskIntakePreviewTask[]) {
  const errors = tasks.reduce((sum, task) => sum + task.errors.length, 0);
  const warnings = tasks.reduce((sum, task) => sum + task.warnings.length, 0);
  return { errors, warnings, valid: tasks.length > 0 && errors === 0 };
}

function taskTypeLabel(taskType: TaskIntakePreviewTask["taskType"]) {
  if (taskType === "proposal") return "Vorschlag";
  if (taskType === "sub_issue") return "Sub-Issue";
  return "Deliverable";
}

function intakeMessageLabel(message: string) {
  if (message.startsWith("Ungültiger Aufgabentyp:")) return "Aufgabentyp konnte nicht zugeordnet werden.";
  if (message.startsWith("Initiative wurde nicht gefunden:")) return "Initiative wurde nicht gefunden. Bitte eine vorhandene Initiative aus der Zuordnungshilfe verwenden.";
  if (message.startsWith("Epic / Meilenstein wurde nicht gefunden:")) return "Epic oder Meilenstein wurde nicht gefunden. Bitte eine vorhandene Zuordnung verwenden.";
  if (message.startsWith("Sprint wurde nicht gefunden:")) return "Sprint wurde nicht gefunden. Bitte einen offenen Sprint aus der Zuordnungshilfe verwenden.";
  if (message.startsWith("Parent-Task wurde nicht gefunden:")) return "Übergeordnetes Deliverable wurde nicht gefunden. Bitte eine vorhandene Aufgabe verwenden.";
  if (message.startsWith("Zuständige Person wurde nicht gefunden:")) return "Zuständige Person wurde nicht gefunden. Bitte ein Teammitglied aus der Zuordnungshilfe verwenden.";
  if (message.startsWith("Status auf Offen gesetzt")) return "Status wurde auf Offen gesetzt, weil der importierte Wert nicht bekannt ist.";
  return message;
}

export function CeoTaskIntake({ source, profiles, packages, sprints, apiClient, onTasksCreated }: Props) {
  const [rawInput, setRawInput] = useState(JSON.stringify(sampleTasks, null, 2));
  const [previewTasks, setPreviewTasks] = useState<TaskIntakePreviewTask[]>([]);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const state = useMemo(() => previewState(previewTasks), [previewTasks]);
  const canUseSupabase = source === "supabase";
  const activeSprints = sprints.filter((sprint) => sprint.status !== "closed").slice(0, 5);
  const sprintNameById = useMemo(() => new Map(sprints.map((sprint) => [sprint.id, sprint.name])), [sprints]);

  const parsedPayload = () => {
    const parsed = JSON.parse(rawInput) as unknown;
    return parsed;
  };

  const sendIntakeRequest = async (type: "preview" | "commit") => {
    if (!canUseSupabase) {
      setMessage("Aufgaben können in dieser Umgebung nicht erstellt werden.");
      return null;
    }

    const result = type === "preview"
      ? await previewTaskIntake(apiClient, parsedPayload())
      : await commitTaskIntake(apiClient, parsedPayload());
    const { response, body } = result;
    if (!response.ok) throw new Error(body?.error || "Aufgabenimport konnte nicht verarbeitet werden.");
    return body;
  };

  const preview = async () => {
    setPending(true);
    setMessage("");
    try {
      const body = await sendIntakeRequest("preview") as TaskIntakeResponse | null;
      if (!body?.tasks) return;
      setPreviewTasks(body.tasks);
      const nextState = previewState(body.tasks);
      setMessage(nextState.valid ? "Vorschau ist gültig. Aufgaben können erstellt werden." : "Vorschau enthält Fehler und kann nicht erstellt werden.");
    } catch (error) {
      setPreviewTasks([]);
      setMessage(error instanceof SyntaxError ? "JSON konnte nicht gelesen werden." : error instanceof Error ? error.message : "Preview fehlgeschlagen.");
    } finally {
      setPending(false);
    }
  };

  const commit = async () => {
    setPending(true);
    setMessage("");
    try {
      const body = await sendIntakeRequest("commit") as TaskIntakeCommitResponse | null;
      if (!body?.tasks) return;
      onTasksCreated(body.tasks);
      setPreviewTasks([]);
      setMessage(`${body.tasks.length} Aufgabe(n) wurden erstellt.`);
    } catch (error) {
      setMessage(error instanceof SyntaxError ? "JSON konnte nicht gelesen werden." : error instanceof Error ? error.message : "Commit fehlgeschlagen.");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      <UiPanel>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-blue-700">
              <WandSparkles size={15} />
              Nur CEO
            </div>
            <h2 className="mt-1 text-lg font-semibold text-slate-950">Aufgaben importieren</h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600">
              Füge ein Aufgabenpaket ein, prüfe die fachliche Vorschau und erstelle danach die freigegebenen Aufgaben.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <UiButton
              disabled={pending || !canUseSupabase}
              onClick={preview}
              variant="blue"
            >
              <ClipboardList size={16} />
              Vorschau prüfen
            </UiButton>
            <UiButton
              disabled={pending || !state.valid || !canUseSupabase}
              onClick={commit}
              variant="primary"
            >
              <CheckCircle2 size={16} />
              Aufgaben erstellen
            </UiButton>
          </div>
        </div>

        <label className="mt-4 grid gap-2 text-xs font-semibold text-slate-500">
          Importquelle
          <textarea
            value={rawInput}
            onChange={(event) => setRawInput(event.target.value)}
            className="min-h-[420px] w-full resize-y rounded-md border border-slate-200 bg-slate-950 p-4 font-mono text-sm leading-6 text-slate-50 outline-none focus:border-blue-400"
            spellCheck={false}
          />
        </label>

        {message && (
          <UiNotice tone={state.valid ? "success" : "warning"} className="mt-3 leading-normal">
            {message}
          </UiNotice>
        )}

        {previewTasks.length > 0 && (
          <div className="mt-4 grid gap-3">
            <div className="flex flex-wrap gap-2 text-xs font-semibold">
              <UiBadge tone="white">{previewTasks.length} Aufgaben</UiBadge>
              <UiBadge tone="red">{state.errors} Fehler</UiBadge>
              <UiBadge tone="amber">{state.warnings} Hinweise</UiBadge>
            </div>
            {previewTasks.map((task) => (
              <article key={task.clientId} className="rounded-lg border border-slate-200 p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="break-words text-sm font-semibold text-slate-950">{task.title || "Ohne Titel"}</h3>
                    <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
                      <UiBadge tone="white">{taskTypeLabel(task.taskType)}</UiBadge>
                      <UiBadge tone="white">{task.packageTitle || "Ohne Initiative"}</UiBadge>
                      <UiBadge tone="white">{task.sprintId ? sprintNameById.get(task.sprintId) || "Sprint nicht gefunden" : "Ohne Sprint"}</UiBadge>
                      <UiBadge tone="white">{task.assigneeName || "Ohne Zuständigkeit"}</UiBadge>
                      <UiBadge tone="white">{task.hours}h</UiBadge>
                    </div>
                  </div>
                  <UiBadge tone={task.errors.length ? "red" : "emerald"}>
                    {task.errors.length ? "Fehler" : "gültig"}
                  </UiBadge>
                </div>
                <div className="mt-3 grid gap-2 text-xs leading-5 text-slate-600 sm:grid-cols-2">
                  <div><span className="font-semibold text-slate-800">Priorität:</span> {task.priority}</div>
                  <div><span className="font-semibold text-slate-800">Status:</span> {task.status}</div>
                  <div><span className="font-semibold text-slate-800">Review:</span> {task.reviewOwnerName || "Ohne Review Owner"}</div>
                  <div><span className="font-semibold text-slate-800">Bewertung:</span> {task.scoreRelevant ? "relevant" : "nicht bewertet"}</div>
                </div>
                {[...task.errors, ...task.warnings].length > 0 && (
                  <ul className="mt-3 grid gap-1 text-xs leading-5 text-slate-600">
                    {[...task.errors, ...task.warnings].map((item) => (
                      <li key={item} className="flex gap-2">
                        <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-500" />
                        <span>{intakeMessageLabel(item)}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <details className="mt-3 rounded-md border border-slate-100 bg-slate-50 px-3 py-2 text-xs text-slate-500">
                  <summary className="cursor-pointer list-none font-semibold text-slate-600">Importdetails anzeigen</summary>
                  <div className="mt-2 grid gap-1">
                    <div>Typ: {task.taskType}</div>
                    <div>Initiative: {task.packageId || "nicht gesetzt"}</div>
                    <div>Sprint: {task.sprintId || "nicht gesetzt"}</div>
                    {task.parentTaskId && <div>Übergeordnetes Deliverable: {task.parentTaskId}</div>}
                  </div>
                </details>
              </article>
            ))}
          </div>
        )}
      </UiPanel>

      <aside className="grid h-fit gap-4">
        <UiPanel>
          <h3 className="text-sm font-semibold text-slate-950">Zuordnungshilfe</h3>
          <div className="mt-3 grid gap-3 text-xs leading-5 text-slate-600">
            <div>
              <div className="font-semibold text-slate-800">Team</div>
              <p>{profiles.map((profile) => profile.name).join(", ")}</p>
            </div>
            <div>
              <div className="font-semibold text-slate-800">Aktive Sprints</div>
              <p>{activeSprints.map((sprint) => sprint.name).join(", ") || "Keine offenen Sprints"}</p>
            </div>
            <div>
              <div className="font-semibold text-slate-800">Initiativen</div>
              <p>{packages.slice(0, 12).map((pack) => pack.title).join(", ")}</p>
            </div>
          </div>
        </UiPanel>

        <UiPanel>
          <h3 className="text-sm font-semibold text-slate-950">Geschützte Felder</h3>
          <div className="mt-3 grid gap-2 text-sm leading-6 text-slate-600">
            <p>Neue Aufgaben entstehen erst nach gültiger Vorschau und aktiver Bestätigung.</p>
            <p>Planung, RACI, Sprint, Review Owner, Punkte und Erledigt werden nicht automatisch überschrieben.</p>
            <p>Bestehende Aufgaben bleiben unverändert, bis du neue Aufgaben explizit erstellst.</p>
          </div>
        </UiPanel>
      </aside>
    </div>
  );
}
