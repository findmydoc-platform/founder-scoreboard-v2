"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  editableTeamWorkweekDraft,
  formatTeamWorkweekActivation,
  emptyTeamWorkweekWindows,
  nextMondayIso,
  validatePrivateTeamWorkweekDraft,
  type OwnTeamWorkweekPublication,
  type PrivateTeamWorkweekDraft,
  type PrivateTeamWorkweekVersion,
  type TeamWorkweekDayKey,
  type TeamWorkweekEditBase,
  type TeamWorkweekConflict,
  type TeamWorkweekWindow,
  type WorkweekActivationMode,
} from "../model/team-workweek-draft";
import type { BrowserApiClient } from "@/lib/browser-api-client";
import { TEAM_WORKWEEK_PUBLISHED_EVENT } from "./use-published-team-workweeks";

function initialDraft(effectiveFrom = nextMondayIso()): PrivateTeamWorkweekDraft {
  return { effectiveFrom, windows: emptyTeamWorkweekWindows() };
}

export function usePrivateTeamWorkweek(apiClient: BrowserApiClient) {
  const mounted = useRef(true);
  const mutationPending = useRef(false);
  const [version, setVersion] = useState<PrivateTeamWorkweekVersion | null>(null);
  const [publicationClock, setPublicationClock] = useState(() => Date.now());
  const [publication, setPublication] = useState<OwnTeamWorkweekPublication | null>(null);
  const [latestPublished, setLatestPublished] = useState<OwnTeamWorkweekPublication | null>(null);
  const [conflict, setConflict] = useState<TeamWorkweekConflict | null>(null);
  const [immediateAllowed, setImmediateAllowed] = useState(false);
  const [minimumEffectiveFrom, setMinimumEffectiveFrom] = useState(() => nextMondayIso());
  const [draft, setDraft] = useState<PrivateTeamWorkweekDraft>(() => initialDraft());
  const [baseline, setBaseline] = useState<PrivateTeamWorkweekDraft>(() => initialDraft());
  const [pending, setPending] = useState(true);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"success" | "warning">("success");
  const [errors, setErrors] = useState<string[]>([]);
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(baseline), [baseline, draft]);

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
  }, []);

  const load = useCallback(async () => {
    setPending(true);
    setMessage("");
    try {
      const { response, body } = await apiClient.requestJson<{
        version?: PrivateTeamWorkweekVersion | null;
        publication?: OwnTeamWorkweekPublication | null;
        latestPublished?: OwnTeamWorkweekPublication | null;
        editBase?: TeamWorkweekEditBase | null;
        minimumEffectiveFrom?: string;
        immediateAllowed?: boolean;
        error?: string;
      }>("/api/team-workweek/private-draft", { cache: "no-store", useDevProfileOverride: false });
      if (!response.ok || body?.version === undefined || typeof body.minimumEffectiveFrom !== "string") {
        throw new Error(body?.error || "Private Grundwoche konnte nicht geladen werden.");
      }
      if (mounted.current) {
        setPublication(body.publication || null);
        setLatestPublished(body.latestPublished || null);
        setMinimumEffectiveFrom(body.minimumEffectiveFrom);
        setImmediateAllowed(body.immediateAllowed ?? !body.latestPublished);
        applyVersion(body.version, body.minimumEffectiveFrom, body.editBase || null, body.immediateAllowed ?? !body.latestPublished);
      }
      const conflictResponse = await apiClient.requestJson<{ conflict?: TeamWorkweekConflict | null; error?: string }>(
        "/api/team-workweek/conflict",
        { cache: "no-store", useDevProfileOverride: false },
      );
      if (!conflictResponse.response.ok || conflictResponse.body?.conflict === undefined) {
        throw new Error(conflictResponse.body?.error || "Synchronisationskonflikt konnte nicht geladen werden.");
      }
      if (mounted.current) setConflict(conflictResponse.body.conflict || null);
    } catch (error) {
      if (mounted.current) {
        setMessageTone("warning");
        setMessage(error instanceof Error ? error.message : "Private Grundwoche konnte nicht geladen werden.");
      }
    } finally {
      if (mounted.current) setPending(false);
    }
  }, [apiClient, applyVersion]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeout);
  }, [load]);

  useEffect(() => {
    const effectiveAt = latestPublished?.effectiveAt;
    if (!effectiveAt || new Date(effectiveAt).getTime() <= Date.now()) return;
    let timeout: number;
    const refreshAtBoundary = () => {
      const remaining = new Date(effectiveAt).getTime() - Date.now();
      if (remaining > 0) {
        timeout = window.setTimeout(refreshAtBoundary, Math.min(2_147_483_647, remaining + 100));
        return;
      }
      setLatestPublished((current) => current ? { ...current } : null);
      setImmediateAllowed(true);
    };
    refreshAtBoundary();
    return () => window.clearTimeout(timeout);
  }, [latestPublished?.effectiveAt]);

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
    const validation = validatePrivateTeamWorkweekDraft(draft, new Date(), minimumEffectiveFrom);
    if (!validation.ok) {
      setErrors(validation.errors);
      return null;
    }
    setMessage("");
    setErrors([]);
    try {
      const { response, body } = await apiClient.requestJson<{
        version?: Omit<PrivateTeamWorkweekVersion, "windows">;
        error?: string;
      }>("/api/team-workweek/private-draft", { method: "POST", json: { ...validation.draft, ...(validation.draft.activationMode === "immediate" && latestPublished ? { basePublicationId: validation.draft.basePublicationId || latestPublished.id, basePublicationRevision: validation.draft.basePublicationRevision || latestPublished.publicationRevision } : {}) }, useDevProfileOverride: false });
      if (!response.ok || !body?.version) {
        throw new Error(body?.error || "Private Grundwoche konnte nicht gespeichert werden.");
      }
      const saved = { ...body.version, windows: validation.draft.windows } as PrivateTeamWorkweekVersion;
      if (mounted.current) {
        applyVersion(saved);
        setPublication(null);
        setMessageTone("success");
        setMessage("Änderung privat gespeichert. Im Team und in Google bleibt sie bis zur Veröffentlichung unverändert.");
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

  const publish = async () => {
    if (mutationPending.current || pending) return false;
    mutationPending.current = true;
    setPending(true);
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
          activationMode?: WorkweekActivationMode;
          recovery: "retry" | "reconnect" | "identity_conflict" | null;
        };
        conflict?: { id: string; conflictRevision: number };
        error?: string;
      }>("/api/team-workweek/publish", {
        method: "POST",
        json: { versionId: publishingVersion.id },
        useDevProfileOverride: false,
      });
      if (!response.ok && response.status !== 202) {
        if (response.status === 409 && body?.conflict) {
          await load();
          setMessageTone("warning");
          setMessage("FounderOps und Google wurden parallel geändert. Wähle unten bewusst eine Variante.");
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
        ? `Arbeitswoche bestätigt. Gültig ab ${formatTeamWorkweekActivation(body.publication.effectiveAt)}.`
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
      mutationPending.current = false;
      if (mounted.current) setPending(false);
    }
  };

  const resolveConflict = async (decision: "founderops" | "google") => {
    if (!conflict) return false;
    setPending(true);
    setMessage("");
    try {
      const { response, body } = await apiClient.requestJson<{
        publication?: { status: "preparing" | "published"; recovery: string | null };
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
      setMessage(decision === "founderops"
        ? "Deine FounderOps-Variante wurde erneut geprüft und auf beiden Seiten bestätigt."
        : "Die Google-Variante wurde erneut geprüft und auf beiden Seiten bestätigt.");
      window.dispatchEvent(new Event(TEAM_WORKWEEK_PUBLISHED_EVENT));
      return true;
    } catch (error) {
      if (mounted.current) {
        setMessageTone("warning");
        setMessage(error instanceof Error ? error.message : "Konfliktentscheidung konnte nicht bestätigt werden.");
      }
      return false;
    } finally {
      if (mounted.current) setPending(false);
    }
  };

  const reconcile = async () => {
    if (!latestPublished) {
      setMessageTone("warning");
      setMessage("Veröffentliche zuerst eine Grundwoche, bevor du Google abgleichst.");
      return false;
    }
    setPending(true);
    setMessage("");
    try {
      const { response, body } = await apiClient.requestJson<{
        reconciliation?: {
          state: "unchanged" | "updated" | "delayed" | "conflict";
          lastSuccessfulSyncAt: string | null;
          recovery: "retry" | "reconnect" | "resolve_conflict" | null;
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
        setMessage("Google-Änderung wurde für die Bearbeitung ab dem nächsten Montag übernommen.");
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
    immediateAllowed,
    pending,
    publication,
    publicationExpired: Boolean(publication?.effectiveAt && new Date(publication.effectiveAt).getTime() <= publicationClock),
    reconcile,
    resolveConflict,
    removeWindow,
    reset,
    save,
    publish,
    setEffectiveFrom,
    setActivationMode,
    setWindow,
    latestPublished,
    version,
  };
}
