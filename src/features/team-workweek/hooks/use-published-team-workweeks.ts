"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { berlinDateKey, type CalendarTeamWorkweek } from "../model/team-workweek-calendar";
import type { BrowserApiClient } from "@/lib/browser-api-client";

export const TEAM_WORKWEEK_PUBLISHED_EVENT = "founderops:team-workweek-published";

export function usePublishedTeamWorkweeks(apiClient: BrowserApiClient) {
  const mounted = useRef(true);
  const [workweeks, setWorkweeks] = useState<CalendarTeamWorkweek[]>([]);
  const [referenceDate, setReferenceDate] = useState(() => berlinDateKey());
  const [nextActivationAt, setNextActivationAt] = useState<string | null>(null);
  const [today, setToday] = useState(() => berlinDateKey());
  const [pending, setPending] = useState(true);
  const [message, setMessage] = useState("");
  const [hasLoadedSuccessfully, setHasLoadedSuccessfully] = useState(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    setPending(true);
    setMessage("");
    try {
      const { response, body } = await apiClient.requestJson<{
        currentWorkweeks?: CalendarTeamWorkweek[];
        workweeks?: Array<{effectiveAt?: string | null}>;
        error?: string;
        referenceDate?: string;
      }>("/api/team-workweek/team", { cache: "no-store" });
      if (!response.ok || !body?.currentWorkweeks || !body.referenceDate) {
        throw new Error(body?.error || "Veröffentlichte Grundwochen konnten nicht geladen werden.");
      }
      if (mounted.current) {
        setWorkweeks(body.currentWorkweeks);
        setNextActivationAt((body.workweeks || []).flatMap((workweek) => workweek.effectiveAt && new Date(workweek.effectiveAt) > new Date() ? [workweek.effectiveAt] : []).sort()[0] || null);
        setReferenceDate(body.referenceDate);
        setHasLoadedSuccessfully(true);
      }
    } catch (error) {
      if (mounted.current) {
        setMessage(error instanceof Error ? error.message : "Veröffentlichte Grundwochen konnten nicht geladen werden.");
      }
    } finally {
      if (mounted.current) setPending(false);
    }
  }, [apiClient]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 0);
    const reload = () => void load();
    window.addEventListener(TEAM_WORKWEEK_PUBLISHED_EVENT, reload);
    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener(TEAM_WORKWEEK_PUBLISHED_EVENT, reload);
    };
  }, [load, today]);

  useEffect(() => {
    if (!nextActivationAt) return;
    const timeout = window.setTimeout(() => void load(), Math.min(2_147_483_647, Math.max(0, new Date(nextActivationAt).getTime() - Date.now()) + 100));
    return () => window.clearTimeout(timeout);
  }, [load, nextActivationAt]);

  useEffect(() => {
    const timer = window.setInterval(() => setToday(berlinDateKey()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  return { hasLoadedSuccessfully, load, message, pending, referenceDate, workweeks };
}
