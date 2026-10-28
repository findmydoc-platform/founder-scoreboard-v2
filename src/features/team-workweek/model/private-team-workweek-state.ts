"use client";

import type { PrivateWorkweekContext, PrivateWorkweekView } from "./private-workweek-planning-state";
import type { PlanningState } from "@/features/planning/model/planning-state";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  editableTeamWorkweekDraft,
  inflatePublishedTeamWorkweekWindows,
  formatTeamWorkweekActivation,
  emptyTeamWorkweekWindows,
  nextMondayIso,
  validatePrivateTeamWorkweekDraft,
  type PrivateTeamWorkweekDraft,
  type PrivateTeamWorkweekVersion,
  type TeamWorkweekDayKey,
  type TeamWorkweekEditBase,
  type TeamWorkweekConflict,
  type TeamWorkweekWindow,
} from "./team-workweek-draft";
import { berlinTodayIso } from "./team-workweek-draft";
import { formatDate } from "@/lib/display";

import { berlinCivilInstant } from "./team-workweek-calendar";
import { selectedWorkweek, workweekStart } from "./team-workweek-week";

function confirmedActivation(effectiveAt?: string | null, effectiveUntil?: string | null) {
  if (!effectiveAt) return "";
  return ` Gültig ab ${formatTeamWorkweekActivation(effectiveAt)}.${effectiveUntil ? ` Die geplante Änderung am ${new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", dateStyle: "medium" }).format(new Date(effectiveUntil))} bleibt erhalten.` : ""}`;
}

function reconciliationNotice(state: PrivateWorkweekView, refreshRequired: boolean) {
  return state.reconciliation.phase === "unconfirmed"
    ? "Ob der Google-Abgleich abgeschlossen ist, bleibt unklar. Die bisher bestätigten Arbeitszeiten bleiben sichtbar. Lade den aktuellen Stand. Dabei wird nichts erneut abgeglichen."
    : state.reconciliation.phase === "reconciling" ? "Google-Abgleich läuft. Der zuletzt bestätigte Teamstand bleibt sichtbar."
    : state.reconciliation.phase === "confirmed" && refreshRequired ? "Der Google-Abgleich ist bestätigt. Lade den aktuellen Stand vor weiteren Änderungen."
    : state.reconciliation.phase === "delayed" || state.reconciliation.phase === "conflict"
      ? state.reconciliation.result?.recovery === "reconnect" ? "Der Google-Abgleich ist verzögert. Verbinde Google erneut; der bestätigte Teamstand bleibt sichtbar."
        : state.reconciliation.result?.recovery === "restart" ? "Die Arbeitswoche wurde inzwischen geändert. Beginne mit dem aktuellen Stand neu. Deine Eingaben bleiben erhalten."
        : state.reconciliation.result?.recovery === "resolve_conflict" ? "Der Google-Abgleich hat einen Konflikt festgestellt. Prüfe die Varianten; der bestätigte Teamstand bleibt sichtbar."
        : "Der Google-Abgleich verzögert sich. Die bisher bestätigten Arbeitszeiten bleiben sichtbar. Du kannst den Abgleich erneut starten."
      : "";
}

function conflictDecisionNotice(state: PrivateWorkweekView, refreshRequired: boolean) {
  const decision = state.conflictDecision;
  if (decision.phase === "unconfirmed") return "Ob deine Auswahl übernommen wurde, ist noch unklar. Prüfe den aktuellen Stand. Deine Auswahl wird dabei nicht erneut gesendet.";
  if (decision.phase === "preparing") return decision.result?.recovery === "reconnect"
    ? "Die gewählte Arbeitswoche wird noch vorbereitet. Verbinde Google erneut. Die bisher bestätigten Arbeitszeiten bleiben aktiv."
    : "Die gewählte Arbeitswoche wird noch vorbereitet. Die bisher bestätigten Arbeitszeiten bleiben aktiv. Du kannst mit dieser Auswahl fortfahren.";
  if (decision.phase === "published" && refreshRequired) return "Deine Auswahl wurde veröffentlicht. Lade den aktuellen Stand vor weiteren Änderungen.";
  if (decision.phase === "stale") return decision.error;
  return "";
}

function recoveryNotice(state: PrivateWorkweekView, refreshRequired: boolean) {
  if (state.restart.phase === "unconfirmed" && state.currentContextReady) return "Ob der frühere Neustart abgeschlossen ist, bleibt unklar. Die aktuellen Daten sind geladen. Neue Eingaben kannst du speichern.";
  if (state.restart.phase === "unconfirmed") return "Ob der Neustart abgeschlossen ist, bleibt unklar. Lade den aktuellen Stand. Dabei wird kein weiterer Neustart ausgelöst.";
  if (state.resume.phase === "unconfirmed" && state.currentContextReady) return "Ob die frühere Veröffentlichung abgeschlossen ist, bleibt unklar. Die aktuellen Daten sind geladen. Deine neuen Eingaben bleiben getrennt erhalten.";
  if (state.resume.phase === "unconfirmed") return "Ob die frühere Veröffentlichung abgeschlossen ist, bleibt unklar. Lade den aktuellen Stand. Dabei wird nichts erneut veröffentlicht.";
  const restart = state.restart.result?.restart;
  if (state.restart.phase === "delayed") return restart?.reason === "legacy_untracked"
    ? "Dieser ältere Versuch kann noch nicht sicher abgebrochen werden. Deine neuen Eingaben bleiben hier im Editor erhalten; der gespeicherte Versuch wird nicht automatisch verworfen."
    : restart?.reason === "in_progress" ? "Neustart verzögert. Eine Google-Anfrage läuft noch. Deine Eingaben bleiben hier im Editor erhalten. Prüfe den Neustart später erneut."
    : restart?.reason === "uncertain" ? "Neustart verzögert. Google hat die letzte Anfrage noch nicht eindeutig bestätigt. Deine Eingaben bleiben hier im Editor erhalten. Prüfe den Neustart später erneut."
    : restart?.recovery === "reconnect" ? "Neustart verzögert. Verbinde Google erneut. Deine Eingaben und der bestätigte Teamstand bleiben erhalten."
    : restart?.recovery === "identity_conflict" ? "Ein Google-Eintrag wurde geändert. Der Neustart ist noch nicht bestätigt. Deine Eingaben und der bestätigte Teamstand bleiben erhalten."
    : "Neustart verzögert. Deine Eingaben und der bestätigte Teamstand bleiben erhalten. Versuche den Neustart erneut.";
  if (state.restart.phase === "ready" && refreshRequired) return "Neustart vorbereitet. Lade den aktuellen Stand vor weiteren Änderungen; deine Eingaben bleiben erhalten.";
  if (state.resume.phase === "confirmed" && refreshRequired) return "Die frühere Veröffentlichung ist bestätigt. Lade den aktuellen Stand vor dem Speichern erneut; deine Eingaben bleiben erhalten.";
  if (state.resume.phase === "preparing") return state.resume.result?.recovery === "reconnect"
    ? "Verbinde Google erneut, bevor du die offene Veröffentlichung fortsetzt. Deine Eingaben bleiben erhalten."
    : "Die frühere Veröffentlichung bleibt in Vorbereitung. Deine Eingaben und der letzte bestätigte Teamstand bleiben erhalten.";
  return "";
}

function initialDraft(effectiveFrom = nextMondayIso()): PrivateTeamWorkweekDraft {
  return { effectiveFrom, windows: emptyTeamWorkweekWindows() };
}

export function usePrivateTeamWorkweekState(planningState: PlanningState, initialWeek?: string) {
  const mounted = useRef(true);
  const loadSequence = useRef(0);
  const shared = useSyncExternalStore(planningState.subscribe, planningState.privateWorkweek, planningState.privateWorkweek);
  const context = shared.context;
  // Pin the displayed editing basis beside the local draft. Shared reads cannot rebase it.
  const [weekContext, setWeekContext] = useState<PrivateWorkweekContext["weekContext"] | null>(context?.weekContext || null);
  const [editingVersionId, setEditingVersionId] = useState<string | null>(context?.version?.id || null);
  const mutationPending = useRef(false);
  const version = context?.version || null;
  const publication = context?.publication || null;
  const pendingPublication = context?.pendingPublication || null;
  const latestPublished = context?.latestPublished || null;
  const [currentEditBase, setCurrentEditBase] = useState<TeamWorkweekEditBase | null>(context?.editBase || null);
  const [elapsedSuccessorId, setElapsedSuccessorId] = useState<string | null>(null);
  const preparedSuccessor = context?.preparedSuccessor?.id === elapsedSuccessorId ? null : context?.preparedSuccessor || null;
  const [displayedConflict, setConflict] = useState<TeamWorkweekConflict | null>(shared.conflict);
  const conflictResolved = shared.conflictDecision.phase === "published" && shared.conflictDecision.submitted?.conflictId === displayedConflict?.id && shared.conflictDecision.submitted?.conflictRevision === displayedConflict?.conflictRevision;
  const conflictWithheld = ["not-loaded", "forbidden"].includes(shared.readStatus) || ["not-loaded", "forbidden"].includes(shared.conflictReadStatus);
  const conflict = conflictWithheld || conflictResolved ? null : displayedConflict;
  const conflictChanged = Boolean(conflict && shared.conflictReadStatus === "current" && (shared.conflict?.id !== conflict.id || shared.conflict?.conflictRevision !== conflict.conflictRevision));
  const restartAvailable = context?.restartAvailable || false;
  const [localContextRefreshRequired, setContextRefreshRequired] = useState(false);
  const contextRefreshRequired = localContextRefreshRequired || shared.contextRefreshRequired;
  const minimumEffectiveFrom = context?.minimumEffectiveFrom || nextMondayIso();
  const loadedDraft = () => context ? editableTeamWorkweekDraft({ version: context.version, editBase: context.editBase || null, minimumEffectiveFrom: context.minimumEffectiveFrom }) : initialDraft();
  const retainedSubmission = useCallback(() => {
    const current = planningState.privateWorkweek();
    if (current.currentContextReady) return undefined;
    if ((current.save.phase === "unconfirmed" || current.save.phase === "saving") && current.save.submitted) return current.save.submitted;
    if ((current.publication.phase === "unconfirmed" || current.publication.phase === "publishing" || current.publication.phase === "preparing") && current.publication.sourceVersion) return editableTeamWorkweekDraft({ version: current.publication.sourceVersion, editBase: null, minimumEffectiveFrom: current.publication.sourceVersion.effectiveFrom });
    return undefined;
  }, [planningState]);
  const [draft, setDraft] = useState<PrivateTeamWorkweekDraft>(() => retainedSubmission() || loadedDraft());
  const [baseline, setBaseline] = useState<PrivateTeamWorkweekDraft>(loadedDraft);
  const [localPending, setPending] = useState(true);
  const sharedOperating = shared.save.phase === "saving" || shared.publication.phase === "publishing" || shared.reconciliation.phase === "reconciling" || shared.conflictDecision.phase === "resolving" || shared.restart.phase === "restarting" || shared.resume.phase === "resuming";
  const pending = localPending || sharedOperating;
  const [operating, setOperating] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [editingToday, setEditingToday] = useState(() => workweekStart());
  const editingVersion = version?.id === editingVersionId ? version : null;
  const selectedWeekStart = editingVersion?.selectedWeekStart || (publication?.status === "preparing" && editingVersion?.activationMode === "future_monday" ? editingVersion.effectiveFrom : weekContext?.weekStart || (draft.activationMode === "immediate" ? workweekStart() : draft.effectiveFrom));
  const weekExpired = selectedWeekStart < editingToday;
  useEffect(() => {
    let timer: number;
    const schedule = () => {
      timer = window.setTimeout(() => {
        setEditingToday(workweekStart());
        schedule();
      }, Math.min(60_000, Math.max(100, berlinCivilInstant(nextMondayIso(), "00:00") - Date.now() + 100)));
    };
    schedule();
    return () => window.clearTimeout(timer);
  }, []);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"success" | "warning">("success");
  const [errors, setErrors] = useState<string[]>([]);
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(baseline), [baseline, draft]);
  const mustRestartBeforeSaving = Boolean(pendingPublication || (dirty && publication?.status === "preparing"));

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const applyVersion = useCallback((
    nextVersion: PrivateTeamWorkweekVersion | null,
    emptyEffectiveFrom = nextMondayIso(),
    editBase: TeamWorkweekEditBase | null = null,
    firstPublication = false,
  ) => {
    const nextDraft = { ...editableTeamWorkweekDraft({
      editBase,
      minimumEffectiveFrom: emptyEffectiveFrom,
      version: nextVersion,
    }), ...(firstPublication && !nextVersion ? { activationMode: "immediate" as const } : {}) };
    setEditingVersionId(nextVersion?.id || null);
    setDraft(nextDraft);
    setBaseline(nextDraft);
    return nextDraft;
  }, []);

  const load = useCallback(async (preservedDraft?: PrivateTeamWorkweekDraft, requestedWeek?: string, duringOperation = false) => {
    if ((mutationPending.current || planningState.privateWorkweek().save.phase === "saving" || planningState.privateWorkweek().publication.phase === "publishing" || planningState.privateWorkweek().reconciliation.phase === "reconciling" || planningState.privateWorkweek().conflictDecision.phase === "resolving" || planningState.privateWorkweek().restart.phase === "restarting" || planningState.privateWorkweek().resume.phase === "resuming") && !duringOperation) return false;
    const sequence = ++loadSequence.current;
    setPending(true);
    setMessage("");
    try {
      const [draftResponse, conflictResponse] = await Promise.all([
        planningState.loadPrivateWorkweek(requestedWeek), planningState.loadWorkweekConflict(),
      ]);
      const body = draftResponse.value;
      const response = { ok: draftResponse.status >= 200 && draftResponse.status < 300 };
      if (!response.ok || body?.version === undefined || typeof body.minimumEffectiveFrom !== "string") {
        throw new Error(body?.error || "Private Grundwoche konnte nicht geladen werden.");
      }
      if (!mounted.current || sequence !== loadSequence.current) return false;
      if (conflictResponse.status < 200 || conflictResponse.status >= 300 || conflictResponse.value?.conflict === undefined) {
        throw new Error(conflictResponse.value?.error || "Synchronisationskonflikt konnte nicht geladen werden.");
      }
      if (!mounted.current || sequence !== loadSequence.current) return false;
      setWeekContext(body.weekContext || null);
      setCurrentEditBase(body.editBase || null);
      const chosen = body.weekContext && selectedWorkweek(body.weekContext.weekStart);
      const loadedBase = body.weekContext ? {
        basePublicationId: body.weekContext.basePublicationId || undefined,
        basePublicationRevision: body.weekContext.basePublicationRevision || undefined,
        windows: inflatePublishedTeamWorkweekWindows(body.weekContext.windows),
      } : body.editBase || null;
      const refreshedDraft = applyVersion(body.version, body.weekContext?.weekStart || body.minimumEffectiveFrom, loadedBase as TeamWorkweekEditBase | null, body.immediateAllowed ?? !body.latestPublished);
      if (chosen?.ok && !body.version) {
        refreshedDraft.effectiveFrom = chosen.weekStart;
        refreshedDraft.activationMode = chosen.activationMode;
        setDraft({ ...refreshedDraft });
        setBaseline({ ...refreshedDraft });
      }
      if (preservedDraft) setDraft(body.weekContext ? { ...refreshedDraft, windows: preservedDraft.windows } : { ...refreshedDraft, windows: preservedDraft.windows,
        activationMode: preservedDraft.activationMode,
        effectiveFrom: preservedDraft.activationMode === "immediate" ? refreshedDraft.effectiveFrom : preservedDraft.effectiveFrom > body.minimumEffectiveFrom ? preservedDraft.effectiveFrom : body.minimumEffectiveFrom,
      });
      setConflict(conflictResponse.value!.conflict || null);
      setContextRefreshRequired(false);
      return true;
    } catch (error) {
      if (mounted.current && sequence === loadSequence.current) {
        setContextRefreshRequired(true);
        setMessageTone("warning");
        const failure = error instanceof Error ? error.message : "Private Grundwoche konnte nicht geladen werden.";
        const retained = recoveryNotice(planningState.privateWorkweek(), true) || conflictDecisionNotice(planningState.privateWorkweek(), true) || reconciliationNotice(planningState.privateWorkweek(), true);
        setMessage(retained ? `${retained} ${failure}` : failure);
      }
      return false;
    } finally {
      if (mounted.current && sequence === loadSequence.current && !mutationPending.current) setPending(false);
    }
  }, [applyVersion, planningState]);

  const awaitingOperationLoad = useRef(false);
  useEffect(() => {
    if (planningState.privateWorkweek().save.phase === "saving" || planningState.privateWorkweek().publication.phase === "publishing" || planningState.privateWorkweek().reconciliation.phase === "reconciling" || planningState.privateWorkweek().conflictDecision.phase === "resolving" || planningState.privateWorkweek().restart.phase === "restarting" || planningState.privateWorkweek().resume.phase === "resuming") {
      awaitingOperationLoad.current = true;
      return;
    }
    const timeout = window.setTimeout(() => void load(retainedSubmission(), initialWeek), 0);
    return () => window.clearTimeout(timeout);
  }, [load, initialWeek, planningState, retainedSubmission]);
  useEffect(() => {
    if (!sharedOperating && awaitingOperationLoad.current) {
      awaitingOperationLoad.current = false;
      void load(retainedSubmission(), initialWeek);
    }
  }, [sharedOperating, load, initialWeek, retainedSubmission]);

  const boundarySource = preparedSuccessor || latestPublished;
  const nextPublicationBoundary = boundarySource
    ? boundarySource.effectiveAt ? Date.parse(boundarySource.effectiveAt) : berlinCivilInstant(boundarySource.effectiveFrom, "00:00")
    : null;
  useEffect(() => {
    if (nextPublicationBoundary === null || nextPublicationBoundary <= Date.now()) return;
    const boundary = nextPublicationBoundary;
    let timeout: number;
    const refreshAtBoundary = () => {
      const remaining = boundary - Date.now();
      if (remaining > 0) {
        timeout = window.setTimeout(refreshAtBoundary, Math.min(2_147_483_647, remaining + 100));
        return;
      }
      if (!dirty) void load();
      else {
        setElapsedSuccessorId(preparedSuccessor?.id || null);
        setMessageTone("warning");
        setMessage("Die geplante Arbeitswoche gilt jetzt. Deine Eingaben bleiben erhalten. Lade die Arbeitswoche neu, bevor du diese Bearbeitung veröffentlichst.");
      }
    };
    refreshAtBoundary();
    return () => window.clearTimeout(timeout);
  }, [dirty, nextPublicationBoundary, preparedSuccessor?.id, load]);

  useEffect(() => {
    if (!dirty) return;
    const protectUnsavedChanges = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", protectUnsavedChanges);
    return () => window.removeEventListener("beforeunload", protectUnsavedChanges);
  }, [dirty]);

  const setWindow = (day: TeamWorkweekDayKey, index: number, patch: Partial<TeamWorkweekWindow>) => {
    setErrors([]);
    setDraft((current) => ({
      ...current,
      windows: {
        ...current.windows,
        [day]: current.windows[day].map((window, windowIndex) => windowIndex === index ? { ...window, ...patch } : window),
      },
    }));
  };

  const addWindow = (day: TeamWorkweekDayKey) => {
    setErrors([]);
    setDraft((current) => ({
      ...current,
      windows: { ...current.windows, [day]: [...current.windows[day], { start: "09:00", end: "17:00" }] },
    }));
  };

  const removeWindow = (day: TeamWorkweekDayKey, index: number) => {
    setErrors([]);
    setDraft((current) => ({
      ...current,
      windows: { ...current.windows, [day]: current.windows[day].filter((_, windowIndex) => windowIndex !== index) },
    }));
  };

  const editingBasisIsCurrent = () => {
    if ((planningState.privateWorkweek().context?.version?.id || null) === editingVersionId) return true;
    setContextRefreshRequired(true);
    setMessageTone("warning");
    setMessage("Die gespeicherte Version wurde während deiner Bearbeitung geändert. Deine Eingaben bleiben erhalten. Lade den aktuellen Stand und prüfe sie vor dem Speichern.");
    return false;
  };

  const saveDraft = async () => {
    if (!editingBasisIsCurrent()) return null;
    if (contextRefreshRequired) return null;
    if (weekExpired) { setErrors(["Die ausgewählte Woche ist vorbei. Übernimm deine Eingaben für diese Woche."]); return null; }
    if (mustRestartBeforeSaving) {
      setMessageTone("warning");
      setMessage(pendingPublication ? "Setze zuerst die offene Veröffentlichung fort. Deine Eingaben bleiben erhalten." : "Ein früherer Veröffentlichungsversuch ist noch offen. Beginne mit dem aktuellen Stand neu; deine Eingaben bleiben hier erhalten.");
      return null;
    }
    const validation = validatePrivateTeamWorkweekDraft(draft, new Date(), weekContext ? nextMondayIso() : minimumEffectiveFrom);
    if (!validation.ok) {
      setErrors(validation.errors);
      return null;
    }
    setMessage("");
    setErrors([]);
    try {
      const { basePublicationId, basePublicationRevision, ...unboundDraft } = validation.draft;
      const immediateBase = version?.activationMode === "future_monday" ? currentEditBase : {
        basePublicationId: basePublicationId || currentEditBase?.basePublicationId || (currentEditBase ? latestPublished?.id : undefined),
        basePublicationRevision: basePublicationRevision || currentEditBase?.basePublicationRevision || (currentEditBase ? latestPublished?.publicationRevision : undefined),
      };
      const saveInput = validation.draft.activationMode === "immediate" ? {
        ...unboundDraft,
        ...(immediateBase?.basePublicationId ? { basePublicationId: immediateBase.basePublicationId, basePublicationRevision: immediateBase.basePublicationRevision } : {}),
      } : validation.draft;
      const result = await planningState.savePrivateWorkweek(weekContext ? { ...saveInput, selectedWeekStart: weekContext.weekStart, contextToken: weekContext.contextToken } : saveInput);
      const body = result.value;
      const response = { ok: result.status >= 200 && result.status < 300, status: result.status };
      if (!response.ok || !body?.version) {
        if (body?.code === "publication_pending" || body?.code === "edit_context_stale") {
          await refreshContext(draft, selectedWeekStart);
          setMessageTone("warning");
          setMessage(body.error || "Der aktuelle Stand muss zuerst geprüft werden. Deine Eingaben bleiben erhalten.");
          return null;
        }
        throw new Error(body?.error || "Private Grundwoche konnte nicht gespeichert werden.");
      }
      const saved = { ...body.version, windows: validation.draft.windows } as PrivateTeamWorkweekVersion;
      if (mounted.current) {
        applyVersion(saved);
        setMessageTone("success");
        setMessage("Entwurf gespeichert. Noch nicht veröffentlicht.");
      }
      return saved;
    } catch (error) {
      if (mounted.current) {
        setMessageTone("warning");
        setMessage(`${error instanceof Error ? error.message : "Private Grundwoche konnte nicht gespeichert werden."} Deine Eingaben bleiben hier erhalten. ${planningState.privateWorkweek().save.phase === "unconfirmed" ? "Die Speicherbestätigung ist ausstehend. Lade zuerst den aktuellen Stand; die Speicherung wird nicht automatisch wiederholt." : "Die Veröffentlichung wurde nicht gestartet."}`);
      }
      return null;
    }
  };

  const beginOperation = () => {
    if (mutationPending.current || pending) return false;
    mutationPending.current = true;
    setOperating(true);
    ++loadSequence.current;
    setPending(true);
    return true;
  };

  const finishOperation = () => {
    mutationPending.current = false;
    if (mounted.current) {
      setOperating(false);
      setPublishing(false);
      setPending(false);
    }
  };

  const refreshContext = (preservedDraft?: PrivateTeamWorkweekDraft, week?: string) => {
    setContextRefreshRequired(true);
    return load(preservedDraft, week, true);
  };

  // A confirmed server outcome is separate from a usable editing context.
  // All operations discharge the same refresh obligation before allowing another write.
  const completeOperation = async ({ preservedDraft, week, success, refreshFailure }: {
    preservedDraft?: PrivateTeamWorkweekDraft;
    week?: string;
    success: string;
    refreshFailure?: string;
  }) => {
    const refreshed = await refreshContext(preservedDraft, week);
    if (!mounted.current) return false;
    const current = planningState.privateWorkweek();
    const recoveryUnknown = current.restart.phase === "unconfirmed" || current.resume.phase === "unconfirmed";
    const unknown = current.reconciliation.phase === "unconfirmed" || recoveryUnknown;
    setMessageTone(refreshed && !unknown ? "success" : "warning");
    setMessage(refreshed && recoveryUnknown ? recoveryNotice(current, current.contextRefreshRequired) : refreshed && unknown ? "Aktueller Stand geladen. Ob der Google-Abgleich abgeschlossen ist, bleibt unklar. Es wurde kein neuer Abgleich gestartet." : refreshed && (planningState.privateWorkweek().save.phase === "unconfirmed" || planningState.privateWorkweek().publication.phase === "unconfirmed") ? "Aktueller Stand geladen. Ob deine Änderungen veröffentlicht wurden, bleibt unklar. Deine Eingaben bleiben erhalten. Es wurde nichts erneut veröffentlicht." : refreshed ? success : refreshFailure || "Die Änderung ist bestätigt. Lade den aktuellen Stand vor dem Speichern erneut; deine Eingaben bleiben erhalten.");
    return refreshed;
  };

  const save = async () => {
    if (!beginOperation()) return false;
    try {
      return Boolean(await saveDraft());
    } finally {
      finishOperation();
    }
  };

  const restart = async (targetVersionId = version?.id, retainedWeek?: string) => {
    if (mutationPending.current || pending || (!targetVersionId && !contextRefreshRequired)) return false;
    if (!beginOperation()) return false;
    setMessage("");
    try {
      if (contextRefreshRequired && planningState.privateWorkweek().recovery.restartVersionId !== targetVersionId) return await completeOperation({ preservedDraft: draft, week: retainedWeek || selectedWeekStart, success: "Der aktuelle Stand ist geladen. Prüfe die ausgewählte Woche vor der Veröffentlichung." });
      const result = await planningState.restartWorkweek(targetVersionId!);
      const body = result.value;
      const response = { ok: result.status >= 200 && result.status < 300, status: result.status };
      if ((!response.ok && response.status !== 202) || !body?.restart) {
        throw new Error(body?.error || "Neustart konnte nicht vorbereitet werden.");
      }
      if (body.restart.state !== "ready") {
        setMessageTone("warning");
        setMessage(recoveryNotice(planningState.privateWorkweek(), contextRefreshRequired));
        return false;
      }
      if (!body.version) throw new Error("Neustart konnte nicht vorbereitet werden.");
      const preservedDraft = dirty || retainedWeek ? draft : undefined;
      const refreshedDraft = applyVersion(body.version);
      if (preservedDraft) setDraft({ ...refreshedDraft, windows: preservedDraft.windows, activationMode: preservedDraft.activationMode, effectiveFrom: preservedDraft.effectiveFrom });
      return await completeOperation({ preservedDraft, week: retainedWeek,
        success: "Neustart vorbereitet. Eingaben bleiben erhalten. Prüfe die ausgewählte Woche vor der Veröffentlichung.",
        refreshFailure: "Neustart vorbereitet. Der aktuelle Teamstand konnte noch nicht geladen werden. Deine Eingaben bleiben erhalten. Lade den Stand vor der Veröffentlichung erneut.",
      });
    } catch (error) {
      if (mounted.current) {
        setMessageTone("warning");
        setMessage(error instanceof Error ? error.message : "Neustart konnte nicht vorbereitet werden.");
      }
      return false;
    } finally {
      finishOperation();
    }
  };

  const resumePendingPublication = async () => {
    if (!pendingPublication || mutationPending.current || pending) return false;
    if (!pendingPublication.resumeAllowed) return restart(pendingPublication.sourceVersionId, selectedWeekStart);
    if (!planningState.privateWorkweek().recovery.resumablePublication) return refreshContext(draft, selectedWeekStart);
    if (!beginOperation()) return false;
    setPublishing(true);
    setMessage("");
    const retainedWeek = selectedWeekStart;
    try {
      const result = await planningState.resumeWorkweekPublication(pendingPublication);
      const body = result.value;
      const response = { ok: result.status >= 200 && result.status < 300, status: result.status };
      if (!response.ok || body?.publication?.status !== "published") {
        throw new Error(body?.error || (body?.publication?.recovery === "reconnect"
          ? "Verbinde Google erneut, bevor du die offene Veröffentlichung fortsetzt. Deine Eingaben bleiben erhalten."
          : body?.publication?.recovery === "identity_conflict"
            ? "Ein Google-Eintrag wurde geändert. Prüfe den Konflikt vor dem Fortsetzen; deine Eingaben bleiben erhalten."
            : "Die frühere Veröffentlichung ist noch offen. Deine Eingaben bleiben erhalten."));
      }
      return await completeOperation({ preservedDraft: draft, week: retainedWeek,
        success: "Die frühere Veröffentlichung ist bestätigt. Deine aktuellen Eingaben bleiben unveröffentlicht erhalten.",
        refreshFailure: "Die frühere Veröffentlichung ist bestätigt. Lade den aktuellen Stand vor dem Speichern erneut; deine Eingaben bleiben erhalten.",
      });
    } catch (error) {
      await refreshContext(draft, retainedWeek);
      setMessageTone("warning");
      setMessage(error instanceof Error ? error.message : "Die frühere Veröffentlichung ist noch offen.");
      return false;
    } finally {
      finishOperation();
    }
  };

  const publish = async () => {
    if (!editingBasisIsCurrent()) return false;
    if (contextRefreshRequired || mutationPending.current || pending) return false;
    if (!beginOperation()) return false;
    setPublishing(true);
    setMessage("");
    setErrors([]);
    try {
      const publishingVersion = dirty || !version ? await saveDraft() : version;
      if (!publishingVersion) return false;
      setMessage("");
      const result = await planningState.publishPrivateWorkweek(publishingVersion.id);
      const body = result.value;
      const response = { ok: result.status >= 200 && result.status < 300, status: result.status };
      if (!response.ok && response.status !== 202) {
        if (response.status === 409 && body?.conflict) {
          if (!await refreshContext()) return false;
          setMessageTone("warning");
          setMessage("FounderOps und Google wurden parallel geändert. Vergleiche die Varianten und wähle eine aus.");
          return "conflict" as const;
        }
        if (body?.code === "completion_pending" || body?.completionPending) {
          await refreshContext(draft, selectedWeekStart);
          setMessageTone("warning");
          setMessage(body.error || "Der Abschluss in FounderOps ist noch offen. Setze die Veröffentlichung fort.");
          return false;
        }
        throw new Error(body?.error || "Grundwoche konnte nicht veröffentlicht werden.");
      }
      if (body?.publication?.status !== "published") {
        if (body?.publication?.recovery === "identity_conflict" && !await refreshContext(draft, selectedWeekStart)) return false;
        const lastSuccessfulSync = latestPublished?.lastSyncAt
          ? ` Letzter erfolgreicher Sync: ${new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(latestPublished.lastSyncAt))}.`
          : "";
        setMessageTone("warning");
        setMessage(body?.publication?.recovery === "reconnect"
          ? `Die geänderte Arbeitswoche bleibt privat; der bisherige Teamstand bleibt sichtbar. Verbinde Google erneut.${lastSuccessfulSync}`
          : body?.publication?.recovery === "identity_conflict"
            ? `Die geänderte Arbeitswoche bleibt privat; der bisherige Teamstand bleibt sichtbar. Ein Google-Eintrag wurde seit dem letzten Sync geändert und wird nicht überschrieben.${lastSuccessfulSync}`
            : `Synchronisierung verzögert. Google kann bereits vorläufige App-Termine enthalten. Die geänderte Arbeitswoche bleibt privat, der bisherige Teamstand bleibt sichtbar und der Vorgang kann sicher wiederholt werden.${lastSuccessfulSync}`);
        return false;
      }
      return await completeOperation({
        success: body.publication.effectiveAt
          ? `Arbeitswoche bestätigt.${confirmedActivation(body.publication.effectiveAt, body.publication.effectiveUntil)}`
          : "Arbeitswoche wurde mit Google synchronisiert und im Team veröffentlicht.",
      });
    } catch (error) {
      if (mounted.current) {
        setMessageTone("warning");
        setMessage(`${error instanceof Error ? error.message : "Grundwoche konnte nicht veröffentlicht werden."} Deine gespeicherte Änderung bleibt erhalten. Der zuletzt bestätigte Teamstand bleibt hier sichtbar. Lade zuerst den aktuellen Stand. Die Veröffentlichung wird zur Prüfung nicht wiederholt.`);
      }
      return false;
    } finally {
      finishOperation();
    }
  };

  const resolveConflict = async (decision: "founderops" | "google") => {
    if (!conflict || conflict[decision].supported === false || mutationPending.current || pending) return false;
    if (!beginOperation()) return false;
    setMessage("");
    try {
      const result = await planningState.resolveWorkweekConflict(conflict, decision);
      const body = result.value;
      const response = { ok: result.status >= 200 && result.status < 300, status: result.status };
      if ((!response.ok && response.status !== 202) || !body?.publication) {
        if (response.status === 409) setContextRefreshRequired(true);
        throw new Error(body?.error || "Konfliktentscheidung konnte nicht bestätigt werden.");
      }
      if (body.publication.status !== "published") {
        if (!await refreshContext(dirty ? draft : undefined, dirty ? selectedWeekStart : undefined)) return false;
        setMessageTone("warning");
        setMessage(conflictDecisionNotice(planningState.privateWorkweek(), false));
        return false;
      }
      return await completeOperation({ preservedDraft: dirty ? draft : undefined, week: dirty ? selectedWeekStart : undefined,
        success: `${decision === "founderops" ? "Deine FounderOps-Variante" : "Die Google-Variante"} wurde erneut geprüft und auf beiden Seiten bestätigt.${confirmedActivation(body.publication.effectiveAt, body.publication.effectiveUntil)}`,
      });
    } catch (error) {
      if (mounted.current) {
        setMessageTone("warning");
        setMessage(error instanceof Error ? error.message : "Konfliktentscheidung konnte nicht bestätigt werden.");
      }
      return false;
    } finally {
      finishOperation();
    }
  };

  const reconcile = async () => {
    if (contextRefreshRequired || mutationPending.current || pending) return false;
    if (!latestPublished) {
      setMessageTone("warning");
      setMessage("Veröffentliche zuerst eine Grundwoche, bevor du Google abgleichst.");
      return false;
    }
    if (!beginOperation()) return false;
    setMessage("");
    const preservedDraft = dirty ? draft : undefined;
    const retainedWeek = dirty ? selectedWeekStart : undefined;
    try {
      const result = await planningState.reconcileWorkweek();
      const body = result.value;
      const response = { ok: result.status >= 200 && result.status < 300, status: result.status };
      if ((!response.ok && response.status !== 202 && response.status !== 409) || !body?.reconciliation) {
        throw new Error(body?.error || "Google-Abgleich konnte nicht abgeschlossen werden.");
      }
      if (body.reconciliation.state === "updated" || body.reconciliation.state === "unchanged") {
        return await completeOperation({ preservedDraft, week: retainedWeek,
          success: body.reconciliation.state === "updated"
            ? `Google-Änderung bestätigt.${confirmedActivation(body.reconciliation.effectiveAt, body.reconciliation.effectiveUntil)}`
            : "Die von FounderOps angelegten Google-Serien sind unverändert. Selbst angelegte Google-Termine wurden nicht übernommen.",
        });
      }
      if (!await refreshContext(preservedDraft, retainedWeek)) return false;
      const lastSuccessfulSync = body.reconciliation.lastSuccessfulSyncAt
        ? ` Letzter erfolgreicher Sync: ${new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(body.reconciliation.lastSuccessfulSyncAt))}.`
        : "";
      setMessageTone("warning");
      setMessage(body.reconciliation.recovery === "reconnect"
        ? `Synchronisierung verzögert. Verbinde Google erneut; der letzte Teamstand bleibt aktiv.${lastSuccessfulSync}`
        : body.reconciliation.recovery === "restart"
          ? `Die Ausgangsversion hat sich geändert. Beginne die Bearbeitung mit dem aktuellen Stand neu; deine Eingaben und der bestätigte Teamstand bleiben erhalten.${lastSuccessfulSync}`
        : body.reconciliation.recovery === "resolve_conflict"
          ? `Google-Änderung ist nicht eindeutig. Der letzte Teamstand bleibt aktiv, bis der Konflikt geprüft wurde.${lastSuccessfulSync}`
          : `Synchronisierung verzögert. Der letzte Teamstand bleibt aktiv und der Abgleich kann sicher wiederholt werden.${lastSuccessfulSync}`);
      return false;
    } catch (error) {
      if (mounted.current) {
        setMessageTone("warning");
        setMessage(error instanceof Error ? error.message : "Google-Abgleich konnte nicht abgeschlossen werden.");
      }
      return false;
    } finally {
      finishOperation();
    }
  };

  const reset = () => {
    // Discard also revokes reads that captured the inputs before confirmation.
    if (mutationPending.current) return;
    ++loadSequence.current;
    setPending(false);
    setDraft(baseline);
    setErrors([]);
    setMessage("");
  };

  const syncDelayed = publication?.syncState === "delayed";
  const reconciliationState = latestPublished?.googleReconciliationState;
  const showConfirmedTeamBaseline = Boolean(conflict || syncDelayed || reconciliationState === "conflict" || reconciliationState === "delayed");
  const latestIsPrepared = Boolean(latestPublished && (latestPublished.effectiveAt ? new Date(latestPublished.effectiveAt) > new Date() : latestPublished.effectiveFrom > berlinTodayIso()));
  const badge = shared.restart.phase === "unconfirmed"
    ? { tone: "amber" as const, label: "Neustart noch unklar" }
    : shared.resume.phase === "unconfirmed"
    ? { tone: "amber" as const, label: "Fortsetzung noch unklar" }
    : shared.conflictDecision.phase === "unconfirmed"
    ? { tone: "amber" as const, label: "Auswahl noch unklar" }
    : shared.reconciliation.phase === "unconfirmed"
    ? { tone: "amber" as const, label: "Google-Abgleich noch unklar" }
    : shared.save.phase === "unconfirmed" || shared.publication.phase === "unconfirmed"
    ? { tone: "amber" as const, label: "Speicherung unklar" }
    : contextRefreshRequired
    ? { tone: "amber" as const, label: "Stand nicht aktuell" }
    : syncDelayed
    ? { tone: "amber" as const, label: "Synchronisierung verzögert" }
    : reconciliationState === "conflict"
      ? { tone: "amber" as const, label: "Google-Konflikt" }
      : reconciliationState === "delayed"
        ? { tone: "amber" as const, label: "Synchronisierung verzögert" }
        : version
          ? { tone: "amber" as const, label: "Entwurf gespeichert" }
          : latestIsPrepared
            ? { tone: "blue" as const, label: `Geplant ab ${formatDate(latestPublished!.effectiveFrom)}` }
            : latestPublished
              ? { tone: "emerald" as const, label: "Veröffentlicht" }
              : { tone: "slate" as const, label: "Noch nicht eingerichtet" };
  const conflictContextReady = shared.readStatus === "current"
    && [shared.save, shared.publication, shared.reconciliation].every(operation => operation.phase !== "unconfirmed" || operation.checked);
  const card = {
    badge,
    description: contextRefreshRequired ? "Lade den aktuellen Stand vor weiteren Änderungen." : version ? "Entwurf gespeichert. Noch nicht im Team sichtbar." : latestPublished ? showConfirmedTeamBaseline ? "Letzter bestätigter Teamstand bleibt sichtbar." : latestIsPrepared ? "Die geplante Woche ist bereits im Kalender sichtbar." : "Deine Arbeitszeiten sind in Team und Google bestätigt." : "Deine Arbeitszeiten fehlen noch.",
    triggerLabel: version ? "Bearbeitung fortsetzen" : latestPublished ? "Arbeitswoche bearbeiten" : "Arbeitswoche einrichten",
    triggerWeek: latestIsPrepared && !version ? latestPublished!.effectiveFrom : null,
    triggerDisabled: pending && !version,
    showReconcile: Boolean(latestPublished && !latestIsPrepared),
    canReconcile: !pending && !contextRefreshRequired,
    reconciliationWarning: !version && reconciliationState === "conflict"
      ? "Eine Google-Serienänderung ist nicht eindeutig. Der bestätigte Teamstand bleibt aktiv."
      : !version && reconciliationState === "delayed"
        ? "Der Google-Abgleich ist verzögert. Der bestätigte Teamstand bleibt aktiv." : null,
    showConflictCheck: (shared.conflictDecision.phase === "published" && contextRefreshRequired) || conflictChanged || ["stale", "unconfirmed"].includes(shared.conflictDecision.phase) || (Boolean(conflict) && ["stale", "unavailable"].includes(shared.conflictReadStatus)),
    canResolveConflict: {
      founderops: Boolean(conflict && conflictContextReady && !pending && !conflictChanged && shared.conflictReadStatus === "current" && shared.conflictDecision.phase !== "unconfirmed" && (shared.conflictDecision.phase !== "preparing" || shared.conflictDecision.submitted?.decision === "founderops") && shared.conflict?.founderops.supported !== false && conflict.founderops.supported !== false && (conflict.state !== "resolving" || conflict.decision === "founderops")),
      google: Boolean(conflict && conflictContextReady && !pending && !conflictChanged && shared.conflictReadStatus === "current" && shared.conflictDecision.phase !== "unconfirmed" && (shared.conflictDecision.phase !== "preparing" || shared.conflictDecision.submitted?.decision === "google") && shared.conflict?.google.supported !== false && conflict.google.supported !== false && (conflict.state !== "resolving" || conflict.decision === "google")),
    },
  };
  const editor = {
    syncDelayed,
    loading: pending && !operating,
    closeBlocked: operating,
    canSelectWeek: !pending && publication?.status !== "preparing" && !contextRefreshRequired,
    canSave: !pending && !weekExpired && !contextRefreshRequired && dirty && !mustRestartBeforeSaving,
    canPublish: !pending && !weekExpired && !contextRefreshRequired && !mustRestartBeforeSaving,
    showExpiredWeek: weekExpired && !publication,
    openAttemptWarning: mustRestartBeforeSaving && !pendingPublication && !message
      ? `Ein früherer Veröffentlichungsversuch ist noch offen. ${restartAvailable
        ? "Beginne mit dem aktuellen Stand neu, bevor du diese Änderungen speicherst oder veröffentlichst."
        : "Der gespeicherte Versuch muss zuerst geklärt werden."} Deine Eingaben bleiben hier im Editor erhalten.` : null,
    showRecovery: Boolean((restartAvailable && !pendingPublication) || contextRefreshRequired),
    recoveryLabel: contextRefreshRequired && !shared.recovery.restartVersionId ? "Aktuellen Stand laden" : "Mit aktuellem Stand neu beginnen",
    recoveryFinished: !pending && !restartAvailable && !contextRefreshRequired,
    pendingRecoveryLabel: pendingPublication?.resumeAllowed ? "Offene Veröffentlichung fortsetzen" : "Offene Veröffentlichung sicher neu beginnen",
  };

  const retainedReconciliationMessage = conflictChanged ? "Die Varianten wurden inzwischen geändert. Lade sie neu und wähle erneut."
    : recoveryNotice(shared, contextRefreshRequired) || conflictDecisionNotice(shared, contextRefreshRequired) || reconciliationNotice(shared, contextRefreshRequired);

  return {
    card,
    editor,
    addWindow,
    conflict,
    dirty,
    draft,
    errors,
    message: message || retainedReconciliationMessage,
    messageTone: !message && retainedReconciliationMessage ? "warning" as const : messageTone,
    pending,
    publication,
    pendingPublication,
    resumePendingPublication,
    publishing,
    reconcile,
    resolveConflict,
    refreshConflict: () => load(dirty ? draft : undefined, dirty ? selectedWeekStart : undefined),
    removeWindow,
    reset,
    restart,
    save,
    publish,
    selectWeek: (week: string) => load(undefined, week),
    selectedWeekStart,
    carryIntoCurrentWeek: () => load(draft, workweekStart()),
    weekContext,
    setWindow,
    latestPublished,
    version,
  };
}
