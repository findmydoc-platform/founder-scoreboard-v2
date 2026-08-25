"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  emptyTeamWorkweekWindows,
  nextMondayIso,
  validatePrivateTeamWorkweekDraft,
  type OwnTeamWorkweekPublication,
  type PrivateTeamWorkweekDraft,
  type PrivateTeamWorkweekVersion,
  type TeamWorkweekDayKey,
  type TeamWorkweekWindow,
} from "../model/team-workweek-draft";
import type { BrowserApiClient } from "@/lib/browser-api-client";
import { TEAM_WORKWEEK_PUBLISHED_EVENT } from "./use-published-team-workweeks";

function initialDraft(effectiveFrom = nextMondayIso()): PrivateTeamWorkweekDraft {
  return { effectiveFrom, windows: emptyTeamWorkweekWindows() };
}

export function usePrivateTeamWorkweek(apiClient: BrowserApiClient) {
  const mounted = useRef(true);
  const [version, setVersion] = useState<PrivateTeamWorkweekVersion | null>(null);
  const [publication, setPublication] = useState<OwnTeamWorkweekPublication | null>(null);
  const [latestPublished, setLatestPublished] = useState<OwnTeamWorkweekPublication | null>(null);
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

  const applyVersion = useCallback((nextVersion: PrivateTeamWorkweekVersion | null, emptyEffectiveFrom = nextMondayIso()) => {
    const nextDraft = nextVersion
      ? { effectiveFrom: nextVersion.effectiveFrom, windows: nextVersion.windows }
      : initialDraft(emptyEffectiveFrom);
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
        minimumEffectiveFrom?: string;
        error?: string;
      }>("/api/team-workweek/private-draft", { cache: "no-store", useDevProfileOverride: false });
      if (!response.ok || body?.version === undefined || typeof body.minimumEffectiveFrom !== "string") {
        throw new Error(body?.error || "Private Grundwoche konnte nicht geladen werden.");
      }
      if (mounted.current) {
        setPublication(body.publication || null);
        setLatestPublished(body.latestPublished || null);
        setMinimumEffectiveFrom(body.minimumEffectiveFrom);
        applyVersion(body.version, body.minimumEffectiveFrom);
      }
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
    if (!dirty) return;
    const protectUnsavedChanges = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", protectUnsavedChanges);
    return () => window.removeEventListener("beforeunload", protectUnsavedChanges);
  }, [dirty]);

  const setEffectiveFrom = (effectiveFrom: string) => {
    setErrors([]);
    setDraft((current) => ({ ...current, effectiveFrom }));
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

  const save = async () => {
    const validation = validatePrivateTeamWorkweekDraft(draft, new Date(), minimumEffectiveFrom);
    if (!validation.ok) {
      setErrors(validation.errors);
      return false;
    }
    setPending(true);
    setMessage("");
    setErrors([]);
    try {
      const { response, body } = await apiClient.requestJson<{
        version?: Omit<PrivateTeamWorkweekVersion, "windows">;
        error?: string;
      }>("/api/team-workweek/private-draft", { method: "POST", json: validation.draft, useDevProfileOverride: false });
      if (!response.ok || !body?.version) {
        throw new Error(body?.error || "Private Grundwoche konnte nicht gespeichert werden.");
      }
      const saved = { ...body.version, windows: validation.draft.windows } as PrivateTeamWorkweekVersion;
      if (mounted.current) {
        applyVersion(saved);
        setPublication(null);
        setMessageTone("success");
        setMessage("Neue private Wochenversion gespeichert. Im Team und in Google bleibt sie unveröffentlicht.");
      }
      return true;
    } catch (error) {
      if (mounted.current) {
        setMessageTone("warning");
        setMessage(error instanceof Error ? error.message : "Private Grundwoche konnte nicht gespeichert werden.");
      }
      return false;
    } finally {
      if (mounted.current) setPending(false);
    }
  };

  const publish = async () => {
    if (!version || dirty) {
      setMessageTone("warning");
      setMessage(dirty ? "Speichere die private Version vor der Veröffentlichung." : "Bereite zuerst eine private Grundwoche vor.");
      return false;
    }
    setPending(true);
    setMessage("");
    setErrors([]);
    try {
      const { response, body } = await apiClient.requestJson<{
        publication?: {
          id: string;
          status: "preparing" | "published";
          syncState: "delayed" | "confirmed";
          publicationRevision: number;
          publishedAt: string | null;
          lastSyncAt: string | null;
          recovery: "retry" | "reconnect" | "identity_conflict" | null;
        };
        error?: string;
      }>("/api/team-workweek/publish", {
        method: "POST",
        json: { versionId: version.id },
        useDevProfileOverride: false,
      });
      if (!response.ok && response.status !== 202) {
        throw new Error(body?.error || "Grundwoche konnte nicht veröffentlicht werden.");
      }
      if (body?.publication?.status !== "published") {
        if (body?.publication && mounted.current) {
          setPublication({
            id: body.publication.id,
            effectiveFrom: version.effectiveFrom,
            status: body.publication.status,
            syncState: body.publication.syncState,
            publicationRevision: body.publication.publicationRevision,
            publishedAt: body.publication.publishedAt,
            lastSyncAt: body.publication.lastSyncAt,
          });
        }
        const lastSuccessfulSync = latestPublished?.lastSyncAt
          ? ` Letzter erfolgreicher Sync: ${new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(latestPublished.lastSyncAt))}.`
          : "";
        setMessageTone("warning");
        setMessage(body?.publication?.recovery === "reconnect"
          ? `Die neue Grundwoche bleibt privat; die bisherige Teamversion bleibt sichtbar. Verbinde Google erneut.${lastSuccessfulSync}`
          : body?.publication?.recovery === "identity_conflict"
            ? `Die neue Grundwoche bleibt privat; die bisherige Teamversion bleibt sichtbar. Ein Google-Eintrag wurde seit dem letzten Sync geändert und wird nicht überschrieben.${lastSuccessfulSync}`
            : `Synchronisierung verzögert. Die neue Grundwoche bleibt privat, die bisherige Teamversion bleibt sichtbar und der Vorgang kann sicher wiederholt werden.${lastSuccessfulSync}`);
        return false;
      }
      await load();
      setMessageTone("success");
      setMessage("Grundwoche wurde mit Google synchronisiert und im Team veröffentlicht.");
      window.dispatchEvent(new Event(TEAM_WORKWEEK_PUBLISHED_EVENT));
      return true;
    } catch (error) {
      if (mounted.current) {
        setMessageTone("warning");
        setMessage(error instanceof Error ? error.message : "Grundwoche konnte nicht veröffentlicht werden.");
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
    dirty,
    draft,
    errors,
    load,
    message,
    messageTone,
    minimumEffectiveFrom,
    pending,
    publication,
    removeWindow,
    reset,
    save,
    publish,
    setEffectiveFrom,
    setWindow,
    latestPublished,
    version,
  };
}
