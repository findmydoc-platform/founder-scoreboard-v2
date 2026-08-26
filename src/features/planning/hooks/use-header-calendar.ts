"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { TEAM_WORKWEEK_PUBLISHED_EVENT } from "@/features/team-workweek/hooks/use-published-team-workweeks";
import {
  berlinDateKey,
  calendarGridRange,
  firstCalendarDayOfMonth,
  type CalendarTeamWorkweek,
} from "@/features/team-workweek/model/team-workweek-calendar";
import type { PublishedTeamWorkweek } from "@/features/team-workweek/model/published-team-workweek";
import type { BrowserApiClient } from "@/lib/browser-api-client";

type TeamWorkweekCalendarResponse = Readonly<{
  calendarWorkweeks?: CalendarTeamWorkweek[];
  error?: string;
  workweeks?: PublishedTeamWorkweek[];
}>;

export function useHeaderCalendar({
  apiClient,
  onOpenTeam,
}: {
  apiClient?: BrowserApiClient;
  onOpenTeam: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"events" | "workweek">("events");
  const [now, setNow] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState(() => berlinDateKey());
  const [viewMonth, setViewMonth] = useState(() => firstCalendarDayOfMonth(berlinDateKey()));
  const [pending, setPending] = useState(Boolean(apiClient));
  const [message, setMessage] = useState("");
  const [calendarWorkweeks, setCalendarWorkweeks] = useState<CalendarTeamWorkweek[]>([]);
  const [workweeks, setWorkweeks] = useState<PublishedTeamWorkweek[]>([]);
  const latestRequest = useRef(0);

  const loadVisibleRange = useCallback(async () => {
    if (!apiClient) return;
    const requestId = ++latestRequest.current;
    const range = calendarGridRange(viewMonth);
    setPending(true);
    setMessage("");
    try {
      const { response, body } = await apiClient.requestJson<TeamWorkweekCalendarResponse>(
        `/api/team-workweek/team?from=${range.from}&to=${range.to}`,
        { cache: "no-store" },
      );
      if (!response.ok || !body?.workweeks || !body.calendarWorkweeks) {
        throw new Error(body?.error || "Arbeitszeiten konnten nicht geladen werden.");
      }
      if (requestId !== latestRequest.current) return;
      setWorkweeks(body.workweeks);
      setCalendarWorkweeks((current) => {
        const retained = current.filter((workweek) => (
          workweek.effectiveFrom > range.to
          || Boolean(workweek.effectiveTo && workweek.effectiveTo < range.from)
        ));
        const byId = new Map(retained.map((workweek) => [workweek.id, workweek]));
        for (const workweek of body.calendarWorkweeks || []) byId.set(workweek.id, workweek);
        return [...byId.values()];
      });
    } catch (error) {
      if (requestId !== latestRequest.current) return;
      setMessage(error instanceof Error ? error.message : "Arbeitszeiten konnten nicht geladen werden.");
    } finally {
      if (requestId === latestRequest.current) setPending(false);
    }
  }, [apiClient, viewMonth]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => void loadVisibleRange());
    return () => window.cancelAnimationFrame(frame);
  }, [loadVisibleRange]);

  useEffect(() => {
    if (!apiClient) return;
    const reload = () => void loadVisibleRange();
    window.addEventListener(TEAM_WORKWEEK_PUBLISHED_EVENT, reload);
    return () => window.removeEventListener(TEAM_WORKWEEK_PUBLISHED_EVENT, reload);
  }, [apiClient, loadVisibleRange]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const openCalendar = useCallback(() => {
    setActiveTab("events");
    setOpen(true);
  }, []);
  const closeCalendar = useCallback(() => setOpen(false), []);
  const openTeamWorkspace = useCallback(() => {
    setOpen(false);
    onOpenTeam();
  }, [onOpenTeam]);

  return {
    activeTab,
    calendarWorkweeks,
    closeCalendar,
    message,
    now,
    open,
    openCalendar,
    openTeamWorkspace,
    pending,
    reload: loadVisibleRange,
    selectedDate,
    setActiveTab,
    setSelectedDate,
    setViewMonth,
    viewMonth,
    workweeks,
  };
}
