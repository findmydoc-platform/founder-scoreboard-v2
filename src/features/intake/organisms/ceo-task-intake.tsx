"use client";

import { AlertTriangle, CheckCircle2, ClipboardList, WandSparkles } from "lucide-react";
import { useMemo, useState } from "react";
import { getBrowserSupabase } from "@/lib/supabase";
import type { TaskIntakePreviewTask } from "@/lib/task-intake";
import type { Package, Profile, Sprint, Task } from "@/lib/types";
import { UiBadge, UiButton, UiNotice, UiPanel } from "@/shared/atoms/ui-primitives";

type RequestHeaders = (token?: string, options?: { json?: boolean; github?: boolean }) => Record<string, string>;

type TaskIntakeResponse = {
  ok?: boolean;
  valid?: boolean;
  error?: string;
  tasks?: TaskIntakePreviewTask[];
};

type TaskIntakeCommitResponse = {
  ok?: boolean;
  error?: string;
  tasks?: Task[];
};

type Props = {
  source: "seed" | "supabase";
  profiles: Profile[];
  packages: Package[];
  sprints: Sprint[];
  requestHeaders: RequestHeaders;
  onTasksCreated: (tasks: Task[]) => void;
};

const sampleTasks = {
  tasks: [
    {
      title: "Beispiel-Aufgabe aus CEO Intake",
      taskType: "deliverable",
      packageId: "initiative-id",
      sprintId: "sprint-2",
      owner: "sebastian",
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

export function CeoTaskIntake({ source, profiles, packages, sprints, requestHeaders, onTasksCreated }: Props) {
  const [rawInput, setRawInput] = useState(JSON.stringify(sampleTasks, null, 2));
  const [previewTasks, setPreviewTasks] = useState<TaskIntakePreviewTask[]>([]);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const state = useMemo(() => previewState(previewTasks), [previewTasks]);
  const canUseSupabase = source === "supabase";
  const activeSprints = sprints.filter((sprint) => sprint.status !== "closed").slice(0, 5);

  const parsedPayload = () => {
    const parsed = JSON.parse(rawInput) as unknown;
    return parsed;
  };

  const sendIntakeRequest = async (path: "/api/ceo/task-intake/preview" | "/api/ceo/task-intake/commit") => {
    if (!canUseSupabase) {
      setMessage("CEO Intake schreibt nur gegen Supabase. Im Seed-Fallback ist kein Commit möglich.");
      return null;
    }

    const session = await getBrowserSupabase()?.auth.getSession();
    const token = session?.data.session?.access_token;
    const response = await fetch(path, {
      method: "POST",
      headers: requestHeaders(token),
      body: JSON.stringify(parsedPayload()),
    });
    const body = (await response.json().catch(() => null)) as TaskIntakeResponse | TaskIntakeCommitResponse | null;
    if (!response.ok) throw new Error(body?.error || "Task Intake konnte nicht verarbeitet werden.");
    return body;
  };

  const preview = async () => {
    setPending(true);
    setMessage("");
    try {
      const body = await sendIntakeRequest("/api/ceo/task-intake/preview") as TaskIntakeResponse | null;
      if (!body?.tasks) return;
      setPreviewTasks(body.tasks);
      const nextState = previewState(body.tasks);
      setMessage(nextState.valid ? "Preview ist gültig. Aufgaben können erstellt werden." : "Preview enthält Fehler und kann nicht committed werden.");
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
      const body = await sendIntakeRequest("/api/ceo/task-intake/commit") as TaskIntakeCommitResponse | null;
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
              CEO-only
            </div>
            <h2 className="mt-1 text-lg font-semibold text-slate-950">Task Intake</h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600">
              Füge von Codex erzeugte Aufgaben als JSON ein, prüfe die Preview und erstelle sie danach in Supabase.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <UiButton
              disabled={pending || !canUseSupabase}
              onClick={preview}
              variant="blue"
            >
              <ClipboardList size={16} />
              Preview prüfen
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

        <textarea
          value={rawInput}
          onChange={(event) => setRawInput(event.target.value)}
          className="mt-4 min-h-[420px] w-full resize-y rounded-md border border-slate-200 bg-slate-950 p-4 font-mono text-sm leading-6 text-slate-50 outline-none focus:border-blue-400"
          spellCheck={false}
        />

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
                    <p className="mt-1 text-xs text-slate-500">
                      {task.taskType} · {task.priority} · {task.ownerName || "ohne Assignee"} · Review: {task.reviewOwnerName || "ohne Review Owner"}
                    </p>
                  </div>
                  <UiBadge tone={task.errors.length ? "red" : "emerald"}>
                    {task.errors.length ? "Fehler" : "gültig"}
                  </UiBadge>
                </div>
                {[...task.errors, ...task.warnings].length > 0 && (
                  <ul className="mt-3 grid gap-1 text-xs leading-5 text-slate-600">
                    {[...task.errors, ...task.warnings].map((item) => (
                      <li key={item} className="flex gap-2">
                        <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-500" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </article>
            ))}
          </div>
        )}
      </UiPanel>

      <aside className="grid h-fit gap-4">
        <UiPanel>
          <h3 className="text-sm font-semibold text-slate-950">Verfügbare Referenzen</h3>
          <div className="mt-3 grid gap-3 text-xs leading-5 text-slate-600">
            <div>
              <div className="font-semibold text-slate-800">Team</div>
              <p>{profiles.map((profile) => profile.id).join(", ")}</p>
            </div>
            <div>
              <div className="font-semibold text-slate-800">Aktive Sprints</div>
              <p>{activeSprints.map((sprint) => sprint.id).join(", ") || "Keine offenen Sprints"}</p>
            </div>
            <div>
              <div className="font-semibold text-slate-800">Initiativen</div>
              <p>{packages.slice(0, 12).map((pack) => pack.id).join(", ")}</p>
            </div>
          </div>
        </UiPanel>

        <UiPanel>
          <h3 className="text-sm font-semibold text-slate-950">Team-KI Leitplanken</h3>
          <div className="mt-3 grid gap-2 text-sm leading-6 text-slate-600">
            <p>Team-KI bleibt getrennt vom CEO Intake und nutzt nur die bestehende Browser-Session, keine persönlichen langlebigen API-Tokens.</p>
            <p>Erlaubt sind operative Aktionen wie Kommentar, Evidence, Blocker, Checklisten und Status bis Review.</p>
            <p>Planung, RACI, Sprint, Review Owner, Punkte und Erledigt bleiben geschützt.</p>
          </div>
        </UiPanel>
      </aside>
    </div>
  );
}
