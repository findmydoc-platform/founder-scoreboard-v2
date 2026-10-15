"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  editableTeamWorkweekDraft,
  inflatePublishedTeamWorkweekWindows,
  formatTeamWorkweekActivation,
  emptyTeamWorkweekWindows,
  nextMondayIso,
  validatePrivateTeamWorkweekDraft,
  type OwnTeamWorkweekPublication,
  type PendingTeamWorkweekPublication,
  type PrivateTeamWorkweekDraft,
  type PrivateTeamWorkweekVersion,
  type TeamWorkweekDayKey,
  type TeamWorkweekEditBase,
  type TeamWorkweekConflict,
  type TeamWorkweekWindow,
  type WorkweekActivationMode,
} from "../model/team-workweek-draft";
import type { BrowserApiClient } from "@/lib/browser-api-client";
import { berlinCivilInstant } from "../model/team-workweek-calendar";
import { selectedWorkweek, workweekStart } from "../model/team-workweek-week";
import { TEAM_WORKWEEK_PUBLISHED_EVENT } from "./use-published-team-workweeks";

function confirmedActivation(effectiveAt?: string | null, effectiveUntil?: string | null) {
  if (!effectiveAt) return "";
  return ` Gültig ab ${formatTeamWorkweekActivation(effectiveAt)}.${effectiveUntil ? ` Die geplante Änderung am ${new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", dateStyle: "medium" }).format(new Date(effectiveUntil))} bleibt erhalten.` : ""}`;
}

function initialDraft(effectiveFrom = nextMondayIso()): PrivateTeamWorkweekDraft {
  return { effectiveFrom, windows: emptyTeamWorkweekWindows() };
}

export function usePrivateTeamWorkweek(apiClient: BrowserApiClient, initialWeek?: string) {
  const mounted = useRef(true);
  const loadSequence = useRef(0);
  const [weekContext, setWeekContext] = useState<null | { weekStart: string; contextToken: string; effectiveUntil: string | null; basePublicationId: string | null; basePublicationRevision: number | null; windows: Array<{weekday: number; startMinute: number; endMinute: number}> }>(null);
  const mutationPending = useRef(false);
  const [version, setVersion] = useState<PrivateTeamWorkweekVersion | null>(null);
  const [publicationClock, setPublicationClock] = useState(() => Date.now());
  const [publication, setPublication] = useState<OwnTeamWorkweekPublication | null>(null);
  const [pendingPublication, setPendingPublication] = useState<PendingTeamWorkweekPublication | null>(null);
  const [latestPublished, setLatestPublished] = useState<OwnTeamWorkweekPublication | null>(null);
  const [currentEditBase, setCurrentEditBase] = useState<TeamWorkweekEditBase | null>(null);
  const [preparedSuccessor, setPreparedSuccessor] = useState<OwnTeamWorkweekPublication | null>(null);
  const [conflict, setConflict] = useState<TeamWorkweekConflict | null>(null);
  const [restartAvailable, setRestartAvailable] = useState(false);
  const [restartContextPending, setRestartContextPending] = useState(false);
  const [immediateAllowed, setImmediateAllowed] = useState(false);
  const [minimumEffectiveFrom, setMinimumEffectiveFrom] = useState(() => nextMondayIso());
  const [draft, setDraft] = useState<PrivateTeamWorkweekDraft>(() => initialDraft());
  const [baseline, setBaseline] = useState<PrivateTeamWorkweekDraft>(() => initialDraft());
  const [pending, setPending] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [editingToday, setEditingToday] = useState(() => workweekStart());
  const selectedWeekStart = version?.selectedWeekStart || (publication?.status === "preparing" && version?.activationMode === "future_monday" ? version.effectiveFrom : weekContext?.weekStart || (draft.activationMode === "immediate" ? workweekStart() : draft.effectiveFrom));
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
    setVersion(nextVersion);
    setDraft(nextDraft);
    setBaseline(nextDraft);
    return nextDraft;
  }, []);

  const load = useCallback(async (preservedDraft?: PrivateTeamWorkweekDraft, requestedWeek?: string) => {
    const sequence = ++loadSequence.current;
    setPending(true);
    setMessage("");
    try {
      const { response, body } = await apiClient.requestJson<{
        weekContext?: NonNullable<typeof weekContext>;
        version?: PrivateTeamWorkweekVersion | null;
        publication?: OwnTeamWorkweekPublication | null;
        pendingPublication?: PendingTeamWorkweekPublication | null;
        latestPublished?: OwnTeamWorkweekPublication | null;
        preparedSuccessor?: OwnTeamWorkweekPublication | null;
        editBase?: TeamWorkweekEditBase | null;
        minimumEffectiveFrom?: string;
        immediateAllowed?: boolean;
        restartAvailable?: boolean;
        error?: string;
      }>(`/api/team-workweek/private-draft${requestedWeek ? `?week=${requestedWeek}` : ""}`, { cache: "no-store", useDevProfileOverride: false });
      if (!response.ok || body?.version === undefined || typeof body.minimumEffectiveFrom !== "string") {
        throw new Error(body?.error || "Private Grundwoche konnte nicht geladen werden.");
      }
      if (mounted.current && sequence === loadSequence.current) {
        setWeekContext(body.weekContext || null);
        setPublication(body.publication || null);
        setPendingPublication(body.pendingPublication || null);
        setLatestPublished(body.latestPublished || null);
        setCurrentEditBase(body.editBase || null);
        setPreparedSuccessor(body.preparedSuccessor || null);
        setMinimumEffectiveFrom(body.minimumEffectiveFrom);
        setImmediateAllowed(body.immediateAllowed ?? !body.latestPublished);
        setRestartAvailable(body.restartAvailable ?? false);
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
      }
      const conflictResponse = await apiClient.requestJson<{ conflict?: TeamWorkweekConflict | null; error?: string }>(
        "/api/team-workweek/conflict",
        { cache: "no-store", useDevProfileOverride: false },
      );
      if (!conflictResponse.response.ok || conflictResponse.body?.conflict === undefined) {
        throw new Error(conflictResponse.body?.error || "Synchronisationskonflikt konnte nicht geladen werden.");
      }
      if (mounted.current && sequence === loadSequence.current) {
        setConflict(conflictResponse.body.conflict || null);
        setRestartContextPending(false);
      }
      return true;
    } catch (error) {
      if (mounted.current && sequence === loadSequence.current) {
        setMessageTone("warning");
        setMessage(error instanceof Error ? error.message : "Private Grundwoche konnte nicht geladen werden.");
      }
      return false;
    } finally {
      if (mounted.current && sequence === loadSequence.current) setPending(false);
    }
  }, [apiClient, applyVersion]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(undefined, initialWeek), 0);
    return () => window.clearTimeout(timeout);
  }, [load, initialWeek]);

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
        setPreparedSuccessor(null);
        setMessageTone("warning");
        setMessage("Die geplante Arbeitswoche gilt jetzt. Deine Eingaben bleiben erhalten. Lade die Arbeitswoche neu, bevor du diese Bearbeitung veröffentlichst.");
      }
    };
    refreshAtBoundary();
    return () => window.clearTimeout(timeout);
  }, [dirty, nextPublicationBoundary, load]);

  useEffect(() => {
    const effectiveAt = publication?.effectiveAt;
    if (!effectiveAt) return;
    const timeout = window.setTimeout(() => setPublicationClock(Date.now()), Math.min(2_147_483_647, Math.max(0, new Date(effectiveAt).getTime() - Date.now()) + 100));
    return () => window.clearTimeout(timeout);
  }, [publication?.effectiveAt]);

  useEffect(() => {
    if (!dirty) return;
    const protectUnsavedChanges = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", protectUnsavedChanges);
    return () => window.removeEventListener("beforeunload", protectUnsavedChanges);
  }, [dirty]);

  const setEffectiveFrom = (effectiveFrom: string) => {
    setErrors([]);
    setDraft((current) => ({ ...current, effectiveFrom }));
  };

  const setActivationMode = (activationMode: WorkweekActivationMode) => {
    setErrors([]);
    setDraft((current) => ({ ...current, activationMode, effectiveFrom: minimumEffectiveFrom }));
  };

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

  const saveDraft = async () => {
    if (restartContextPending) return null;
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
      const { response, body } = await apiClient.requestJson<{
        version?: Omit<PrivateTeamWorkweekVersion, "windows">;
        error?: string;
        code?: string;
      }>("/api/team-workweek/private-draft", { method: "POST", json: weekContext ? { ...saveInput, selectedWeekStart: weekContext.weekStart, contextToken: weekContext.contextToken } : saveInput, useDevProfileOverride: false });
      if (!response.ok || !body?.version) {
        if (body?.code === "publication_pending" || body?.code === "edit_context_stale") {
          await load(draft, selectedWeekStart);
          setMessageTone("warning");
          setMessage(body.error || "Der aktuelle Stand muss zuerst geprüft werden. Deine Eingaben bleiben erhalten.");
          return null;
        }
        throw new Error(body?.error || "Private Grundwoche konnte nicht gespeichert werden.");
      }
      const saved = { ...body.version, windows: validation.draft.windows } as PrivateTeamWorkweekVersion;
      if (mounted.current) {
        applyVersion(saved);
        setPublication(null);
        setMessageTone("success");
        setMessage("Entwurf gespeichert. Noch nicht veröffentlicht.");
      }
      return saved;
    } catch (error) {
      if (mounted.current) {
        setMessageTone("warning");
        setMessage(`${error instanceof Error ? error.message : "Private Grundwoche konnte nicht gespeichert werden."} Deine Eingaben bleiben hier erhalten. Versuche erneut zu speichern; die Veröffentlichung wurde nicht gestartet.`);
      }
      return null;
    }
  };

  const save = async () => {
    if (mutationPending.current || pending) return false;
    mutationPending.current = true;
    setPending(true);
    try {
      return Boolean(await saveDraft());
    } finally {
      mutationPending.current = false;
      if (mounted.current) setPending(false);
    }
  };

  const restart = async (targetVersionId = version?.id, retainedWeek?: string) => {
    if (mutationPending.current || pending || !targetVersionId) return false;
    mutationPending.current = true;
    setPending(true);
    setMessage("");
    try {
      if (restartContextPending) return await load(draft, retainedWeek || weekContext?.weekStart);
      const { response, body } = await apiClient.requestJson<{
        version?: PrivateTeamWorkweekVersion;
        restart?: { state: "ready" | "delayed"; recovery: "retry" | "reconnect" | "identity_conflict" | null; reason?: "in_progress" | "uncertain" | "legacy_untracked" };
        error?: string;
      }>("/api/team-workweek/restart", { method: "POST", json: { versionId: targetVersionId }, useDevProfileOverride: false });
      if ((!response.ok && response.status !== 202) || !body?.restart) {
        throw new Error(body?.error || "Neustart konnte nicht vorbereitet werden.");
      }
      if (body.restart.state !== "ready") {
        setMessageTone("warning");
        setMessage(body.restart.reason === "legacy_untracked"
          ? "Dieser ältere Versuch kann noch nicht sicher abgebrochen werden. Deine neuen Eingaben bleiben hier im Editor erhalten; der gespeicherte Versuch wird nicht automatisch verworfen."
          : body.restart.reason === "in_progress"
            ? "Neustart verzögert. Eine Google-Anfrage läuft noch. Deine Eingaben bleiben hier im Editor erhalten. Prüfe den Neustart später erneut."
          : body.restart.reason === "uncertain"
            ? "Neustart verzögert. Google hat die letzte Anfrage noch nicht eindeutig bestätigt. Deine Eingaben bleiben hier im Editor erhalten. Prüfe den Neustart später erneut."
          : body.restart.recovery === "reconnect"
          ? "Neustart verzögert. Verbinde Google erneut. Deine Eingaben und der bestätigte Teamstand bleiben erhalten."
          : body.restart.recovery === "identity_conflict"
            ? "Ein Google-Eintrag wurde geändert. Der Neustart ist noch nicht bestätigt. Deine Eingaben und der bestätigte Teamstand bleiben erhalten."
            : "Neustart verzögert. Deine Eingaben und der bestätigte Teamstand bleiben erhalten. Versuche den Neustart erneut.");
        return false;
      }
      if (!body.version) throw new Error("Neustart konnte nicht vorbereitet werden.");
      const preservedDraft = dirty || retainedWeek ? draft : undefined;
      const refreshedDraft = applyVersion(body.version);
      if (preservedDraft) setDraft({ ...refreshedDraft, windows: preservedDraft.windows, activationMode: preservedDraft.activationMode, effectiveFrom: preservedDraft.effectiveFrom });
      setPublication(null);
      setRestartContextPending(true);
      if (!await load(preservedDraft, retainedWeek)) {
        setMessageTone("warning");
        setMessage("Neustart vorbereitet. Der aktuelle Teamstand konnte noch nicht geladen werden. Deine Eingaben bleiben erhalten. Lade den Stand vor der Veröffentlichung erneut.");
        return false;
      }
      setMessageTone("success");
      setMessage("Neustart vorbereitet. Eingaben bleiben erhalten. Prüfe die ausgewählte Woche vor der Veröffentlichung.");
      return true;
    } catch (error) {
      if (mounted.current) {
        setMessageTone("warning");
        setMessage(error instanceof Error ? error.message : "Neustart konnte nicht vorbereitet werden.");
      }
      return false;
    } finally {
      mutationPending.current = false;
      if (mounted.current) setPending(false);
    }
  };

  const resumePendingPublication = async () => {
    if (!pendingPublication || mutationPending.current || pending) return false;
    if (!pendingPublication.resumeAllowed) return restart(pendingPublication.sourceVersionId, selectedWeekStart);
    mutationPending.current = true;
    setPending(true);
    setPublishing(true);
    setMessage("");
    const retainedWeek = selectedWeekStart;
    try {
      const { response, body } = await apiClient.requestJson<{
        publication?: { status: string; recovery?: "retry" | "reconnect" | "identity_conflict" | null }; error?: string;
      }>("/api/team-workweek/publish", {
        method: "POST", json: { versionId: pendingPublication.sourceVersionId }, useDevProfileOverride: false,
      });
      if (!response.ok || body?.publication?.status !== "published") {
        throw new Error(body?.error || (body?.publication?.recovery === "reconnect"
          ? "Verbinde Google erneut, bevor du die offene Veröffentlichung fortsetzt. Deine Eingaben bleiben erhalten."
          : body?.publication?.recovery === "identity_conflict"
            ? "Ein Google-Eintrag wurde geändert. Prüfe den Konflikt vor dem Fortsetzen; deine Eingaben bleiben erhalten."
            : "Die frühere Veröffentlichung ist noch offen. Deine Eingaben bleiben erhalten."));
      }
      setPendingPublication(null);
      setRestartContextPending(true);
      if (!await load(draft, retainedWeek)) {
        setMessageTone("warning");
        setMessage("Die frühere Veröffentlichung ist bestätigt. Lade den aktuellen Stand vor dem Speichern erneut; deine Eingaben bleiben erhalten.");
        return false;
      }
      setMessageTone("success");
      setMessage("Die frühere Veröffentlichung ist bestätigt. Deine aktuellen Eingaben bleiben unveröffentlicht erhalten.");
      window.dispatchEvent(new Event(TEAM_WORKWEEK_PUBLISHED_EVENT));
      return true;
    } catch (error) {
      await load(draft, retainedWeek);
      setMessageTone("warning");
      setMessage(error instanceof Error ? error.message : "Die frühere Veröffentlichung ist noch offen.");
      return false;
    } finally {
      mutationPending.current = false;
      setPublishing(false);
      if (mounted.current) setPending(false);
    }
  };

  const publish = async () => {
    if (restartContextPending || mutationPending.current || pending) return false;
    mutationPending.current = true;
    setPending(true);
    setPublishing(true);
    setMessage("");
    setErrors([]);
    try {
      const publishingVersion = dirty || !version ? await saveDraft() : version;
      if (!publishingVersion) return false;
      setMessage("");
      const { response, body } = await apiClient.requestJson<{
        publication?: {
          id: string;
          status: "preparing" | "published";
          syncState: "delayed" | "confirmed";
          publicationRevision: number;
          publishedAt: string | null;
          lastSyncAt: string | null;
          effectiveAt?: string | null;
          effectiveUntil?: string | null;
          activationMode?: WorkweekActivationMode;
          recovery: "retry" | "reconnect" | "identity_conflict" | null;
        };
        conflict?: { id: string; conflictRevision: number };
        completionPending?: boolean;
        error?: string;
        code?: string;
      }>("/api/team-workweek/publish", {
        method: "POST",
        json: { versionId: publishingVersion.id },
        useDevProfileOverride: false,
      });
      if (!response.ok && response.status !== 202) {
        if (response.status === 409 && body?.conflict) {
          if (!await load()) return false;
          setMessageTone("warning");
          setMessage("FounderOps und Google wurden parallel geändert. Wähle unten bewusst eine Variante.");
          return "conflict" as const;
        }
        if (body?.code === "completion_pending" || body?.completionPending) {
          await load(draft, selectedWeekStart);
          setMessageTone("warning");
          setMessage(body.error || "Der Abschluss in FounderOps ist noch offen. Setze die Veröffentlichung fort.");
          return false;
        }
        throw new Error(body?.error || "Grundwoche konnte nicht veröffentlicht werden.");
      }
      if (body?.publication?.status !== "published") {
        if (body?.publication && mounted.current) {
          setPublication({
            id: body.publication.id,
            effectiveFrom: publishingVersion.effectiveFrom,
            effectiveAt: body.publication.effectiveAt,
            effectiveUntil: body.publication.effectiveUntil,
            activationMode: body.publication.activationMode,
            status: body.publication.status,
            syncState: body.publication.syncState,
            publicationRevision: body.publication.publicationRevision,
            publishedAt: body.publication.publishedAt,
            lastSyncAt: body.publication.lastSyncAt,
            googleReconciliationState: "confirmed",
            lastGoogleReconciliationAt: null,
          });
        }
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
      await load();
      setMessageTone("success");
      setMessage(body.publication.effectiveAt
        ? `Arbeitswoche bestätigt.${confirmedActivation(body.publication.effectiveAt, body.publication.effectiveUntil)}`
        : "Arbeitswoche wurde mit Google synchronisiert und im Team veröffentlicht.");
      window.dispatchEvent(new Event(TEAM_WORKWEEK_PUBLISHED_EVENT));
      return true;
    } catch (error) {
      if (mounted.current) {
        setMessageTone("warning");
        setMessage(`${error instanceof Error ? error.message : "Grundwoche konnte nicht veröffentlicht werden."} Deine gespeicherte Änderung bleibt erhalten. Der zuletzt bestätigte Teamstand bleibt hier sichtbar. Wiederhole die Veröffentlichung, um den Stand zu prüfen.`);
      }
      return false;
    } finally {
      setPublishing(false);
      mutationPending.current = false;
      if (mounted.current) setPending(false);
    }
  };

  const resolveConflict = async (decision: "founderops" | "google") => {
    if (!conflict || conflict[decision].supported === false || mutationPending.current || pending) return false;
    mutationPending.current = true;
    setPending(true);
    setMessage("");
    try {
      const { response, body } = await apiClient.requestJson<{
        publication?: { status: "preparing" | "published"; recovery: string | null; effectiveAt?: string | null; effectiveUntil?: string | null };
        error?: string;
      }>("/api/team-workweek/conflict", {
        method: "POST",
        json: { conflictId: conflict.id, conflictRevision: conflict.conflictRevision, decision },
        useDevProfileOverride: false,
      });
      if ((!response.ok && response.status !== 202) || !body?.publication) {
        throw new Error(body?.error || "Konfliktentscheidung konnte nicht bestätigt werden.");
      }
      await load();
      if (body.publication.status !== "published") {
        setMessageTone("warning");
        setMessage("Die gewählte Variante bleibt in Vorbereitung. Der letzte bestätigte Teamstand bleibt aktiv; du kannst sicher erneut versuchen.");
        return false;
      }
      setMessageTone("success");
      setMessage(`${decision === "founderops" ? "Deine FounderOps-Variante" : "Die Google-Variante"} wurde erneut geprüft und auf beiden Seiten bestätigt.${confirmedActivation(body.publication.effectiveAt, body.publication.effectiveUntil)}`);
      window.dispatchEvent(new Event(TEAM_WORKWEEK_PUBLISHED_EVENT));
      return true;
    } catch (error) {
      if (mounted.current) {
        setMessageTone("warning");
        setMessage(error instanceof Error ? error.message : "Konfliktentscheidung konnte nicht bestätigt werden.");
      }
      return false;
    } finally {
      mutationPending.current = false;
      if (mounted.current) setPending(false);
    }
  };

  const reconcile = async () => {
    if (mutationPending.current || pending) return false;
    if (!latestPublished) {
      setMessageTone("warning");
      setMessage("Veröffentliche zuerst eine Grundwoche, bevor du Google abgleichst.");
      return false;
    }
    mutationPending.current = true;
    setPending(true);
    setMessage("");
    try {
      const { response, body } = await apiClient.requestJson<{
        reconciliation?: {
          state: "unchanged" | "updated" | "delayed" | "conflict";
          lastSuccessfulSyncAt: string | null;
          effectiveAt?: string | null;
          effectiveUntil?: string | null;
          recovery: "retry" | "reconnect" | "resolve_conflict" | "restart" | null;
        };
        error?: string;
      }>("/api/team-workweek/reconcile", {
        method: "POST",
        json: {},
        useDevProfileOverride: false,
      });
      if ((!response.ok && response.status !== 202 && response.status !== 409) || !body?.reconciliation) {
        throw new Error(body?.error || "Google-Abgleich konnte nicht abgeschlossen werden.");
      }
      await load();
      if (body.reconciliation.state === "updated") {
        setMessageTone("success");
        setMessage(`Google-Änderung bestätigt.${confirmedActivation(body.reconciliation.effectiveAt, body.reconciliation.effectiveUntil)}`);
        window.dispatchEvent(new Event(TEAM_WORKWEEK_PUBLISHED_EVENT));
        return true;
      }
      if (body.reconciliation.state === "unchanged") {
        setMessageTone("success");
        setMessage("Die von FounderOps angelegten Google-Serien sind unverändert. Selbst angelegte Google-Termine wurden nicht übernommen.");
        return true;
      }
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
      mutationPending.current = false;
      if (mounted.current) setPending(false);
    }
  };

  const reset = () => {
    setDraft(baseline);
    setErrors([]);
    setMessage("");
  };

  return {
    addWindow,
    conflict,
    dirty,
    draft,
    errors,
    load,
    message,
    messageTone,
    minimumEffectiveFrom,
    mustRestartBeforeSaving,
    immediateAllowed,
    pending,
    publication,
    pendingPublication,
    resumePendingPublication,
    publishing,
    publicationExpired: Boolean(publication?.effectiveAt && new Date(publication.effectiveAt).getTime() <= publicationClock),
    reconcile,
    resolveConflict,
    removeWindow,
    reset,
    restart,
    restartAvailable,
    restartContextPending,
    save,
    publish,
    selectWeek: (week: string) => load(undefined, week),
    selectedWeekStart,
    weekExpired,
    carryIntoCurrentWeek: () => load(draft, workweekStart()),
    weekContext,
    setEffectiveFrom,
    setActivationMode,
    setWindow,
    latestPublished,
    preparedSuccessor,
    version,
  };
}
