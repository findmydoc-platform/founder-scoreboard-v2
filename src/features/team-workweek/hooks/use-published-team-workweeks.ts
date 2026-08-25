"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PublishedTeamWorkweek } from "../model/published-team-workweek";
import type { BrowserApiClient } from "@/lib/browser-api-client";

export const TEAM_WORKWEEK_PUBLISHED_EVENT = "founderops:team-workweek-published";

export function usePublishedTeamWorkweeks(apiClient: BrowserApiClient) {
  const mounted = useRef(true);
  const [workweeks, setWorkweeks] = useState<PublishedTeamWorkweek[]>([]);
  const [pending, setPending] = useState(true);
  const [message, setMessage] = useState("");

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
        workweeks?: PublishedTeamWorkweek[];
        error?: string;
      }>("/api/team-workweek/team", { cache: "no-store" });
      if (!response.ok || !body?.workweeks) {
        throw new Error(body?.error || "Veröffentlichte Grundwochen konnten nicht geladen werden.");
      }
      if (mounted.current) setWorkweeks(body.workweeks);
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
  }, [load]);

  return { load, message, pending, workweeks };
}
