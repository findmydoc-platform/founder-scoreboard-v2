"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  emptyTeamWorkweekWindows,
  nextMondayIso,
  validatePrivateTeamWorkweekDraft,
  type PrivateTeamWorkweekDraft,
  type PrivateTeamWorkweekVersion,
  type TeamWorkweekDayKey,
  type TeamWorkweekWindow,
} from "../model/team-workweek-draft";
import type { BrowserApiClient } from "@/lib/browser-api-client";

function initialDraft(): PrivateTeamWorkweekDraft {
  return { effectiveFrom: nextMondayIso(), windows: emptyTeamWorkweekWindows() };
}

export function usePrivateTeamWorkweek(apiClient: BrowserApiClient) {
  const mounted = useRef(true);
  const [version, setVersion] = useState<PrivateTeamWorkweekVersion | null>(null);
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

  const applyVersion = useCallback((nextVersion: PrivateTeamWorkweekVersion | null) => {
    const nextDraft = nextVersion
      ? { effectiveFrom: nextVersion.effectiveFrom, windows: nextVersion.windows }
      : initialDraft();
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
        error?: string;
      }>("/api/team-workweek/private-draft", { cache: "no-store" });
      if (!response.ok || body?.version === undefined) {
        throw new Error(body?.error || "Private Grundwoche konnte nicht geladen werden.");
      }
      if (mounted.current) applyVersion(body.version);
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
    const validation = validatePrivateTeamWorkweekDraft(draft);
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
      }>("/api/team-workweek/private-draft", { method: "POST", json: validation.draft });
      if (!response.ok || !body?.version) {
        throw new Error(body?.error || "Private Grundwoche konnte nicht gespeichert werden.");
      }
      const saved = { ...body.version, windows: validation.draft.windows } as PrivateTeamWorkweekVersion;
      if (mounted.current) {
        applyVersion(saved);
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
    pending,
    removeWindow,
    reset,
    save,
    setEffectiveFrom,
    setWindow,
    version,
  };
}
