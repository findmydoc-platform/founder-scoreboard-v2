"use client";

import { useCallback, useEffect, useState } from "react";
import { TEAM_WORKWEEK_PUBLISHED_EVENT } from "./use-published-team-workweeks";
import { createLatestTeamWorkweekRequestRunner } from "../model/latest-team-workweek-request";
import type { PublishedTeamWorkweek } from "../model/published-team-workweek";
import type { BrowserApiClient } from "@/lib/browser-api-client";

async function loadTeamWorkweeks(apiClient: BrowserApiClient) {
  const { response, body } = await apiClient.requestJson<{
    workweeks?: PublishedTeamWorkweek[];
    error?: string;
  }>("/api/team-workweek/team", { cache: "no-store" });
  if (!response.ok || !body?.workweeks) {
    throw new Error(body?.error || "Team-Arbeitswoche konnte nicht geladen werden.");
  }
  return body.workweeks;
}

export function useTeamWorkweekQuickView(
  apiClient: BrowserApiClient,
  onOpenTeam: () => void,
) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [workweeks, setWorkweeks] = useState<PublishedTeamWorkweek[]>([]);

  const [requestRunner] = useState(() => createLatestTeamWorkweekRequestRunner({
    load: () => loadTeamWorkweeks(apiClient),
    onError: (error) => setMessage(error instanceof Error ? error.message : "Team-Arbeitswoche konnte nicht geladen werden."),
    onSettled: () => setPending(false),
    onStart: () => {
      setPending(true);
      setMessage("");
    },
    onSuccess: setWorkweeks,
  }));

  useEffect(() => {
    requestRunner.setLoad(() => loadTeamWorkweeks(apiClient));
  }, [apiClient, requestRunner]);

  useEffect(() => () => requestRunner.invalidate(), [requestRunner]);

  const load = useCallback(async () => {
    await requestRunner.run();
  }, [requestRunner]);

  const openQuickView = useCallback(() => {
    setOpen(true);
    void load();
  }, [load]);
  const closeQuickView = useCallback(() => setOpen(false), []);
  const openTeamWorkspace = useCallback(() => {
    setOpen(false);
    onOpenTeam();
  }, [onOpenTeam]);

  useEffect(() => {
    if (!open) return;
    const reload = () => void load();
    window.addEventListener(TEAM_WORKWEEK_PUBLISHED_EVENT, reload);
    return () => window.removeEventListener(TEAM_WORKWEEK_PUBLISHED_EVENT, reload);
  }, [load, open]);

  return {
    closeQuickView,
    load,
    message,
    open,
    openQuickView,
    openTeamWorkspace,
    pending,
    workweeks,
  };
}
