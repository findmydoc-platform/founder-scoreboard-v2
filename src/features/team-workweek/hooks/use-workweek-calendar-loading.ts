"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { berlinDateKey, type CalendarTeamWorkweek } from "../model/team-workweek-calendar";
import type { BrowserApiClient } from "@/lib/browser-api-client";

export const TEAM_WORKWEEK_PUBLISHED_EVENT = "founderops:team-workweek-published";

type CalendarResponse = {
  currentWorkweeks?: CalendarTeamWorkweek[];
  calendarWorkweeks?: CalendarTeamWorkweek[];
  upcomingWorkweeks?: CalendarTeamWorkweek[];
  publishedOwnerIds?: string[];
  workweeks?: Array<{ effectiveAt?: string | null }>;
  referenceDate?: string;
  error?: string;
};

type CalendarSnapshot = {
  rangeKey: string;
  currentWorkweeks: CalendarTeamWorkweek[];
  calendarWorkweeks: CalendarTeamWorkweek[];
  upcomingWorkweeks: CalendarTeamWorkweek[];
  publishedOwnerIds?: string[];
  referenceDate: string;
  hasCalendarRange: boolean;
  nextActivationAt: string | null;
};

// Selection and retention differ; freshness and refresh obligations do not.
export function useWorkweekCalendarLoading({ apiClient, from, to, enabled, policy }: {
  apiClient?: BrowserApiClient;
  from: string;
  to: string;
  enabled: boolean;
  policy: "team-week" | "header-month";
}) {
  const [now, setNow] = useState(() => new Date());
  const [snapshot, setSnapshot] = useState<CalendarSnapshot | null>(null);
  const [pending, setPending] = useState(enabled);
  const [message, setMessage] = useState("");
  const sequence = useRef(0);
  const rangeKey = `${from}/${to}`;
  const today = berlinDateKey(now);
  const failure = policy === "team-week"
    ? "Veröffentlichte Grundwochen konnten nicht geladen werden."
    : "Arbeitszeiten konnten nicht geladen werden.";

  const load = useCallback(async () => {
    if (!apiClient) return;
    const requestId = ++sequence.current;
    setPending(true);
    setMessage("");
    try {
      const { response, body } = await apiClient.requestJson<CalendarResponse>(
        `/api/team-workweek/team?from=${from}&to=${to}`, { cache: "no-store" },
      );
      if (!response.ok || !body?.currentWorkweeks || !body.referenceDate
        || (policy === "header-month" && !body.calendarWorkweeks)) {
        throw new Error(body?.error || failure);
      }
      if (requestId !== sequence.current) return;
      const currentWorkweeks = body.currentWorkweeks;
      const referenceDate = body.referenceDate;
      const calendarWorkweeks = body.calendarWorkweeks || currentWorkweeks;
      setSnapshot((previous) => {
        const retained = policy === "header-month" ? (previous?.calendarWorkweeks || []).filter((workweek) => (
          workweek.effectiveFrom > to || Boolean(workweek.effectiveTo && workweek.effectiveTo < from)
        )) : [];
        const byId = new Map(retained.map((workweek) => [workweek.id, workweek]));
        for (const workweek of calendarWorkweeks) byId.set(workweek.id, workweek);
        return {
          rangeKey,
          currentWorkweeks,
          calendarWorkweeks: [...byId.values()],
          upcomingWorkweeks: [...(body.upcomingWorkweeks || [])].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom)),
          publishedOwnerIds: body.publishedOwnerIds,
          referenceDate,
          hasCalendarRange: Boolean(body.calendarWorkweeks),
          nextActivationAt: (body.workweeks || []).flatMap((workweek) => (
            workweek.effectiveAt && new Date(workweek.effectiveAt).getTime() > Date.now() ? [workweek.effectiveAt] : []
          )).sort()[0] || null,
        };
      });
    } catch (error) {
      if (requestId === sequence.current) setMessage(error instanceof Error ? error.message : failure);
    } finally {
      if (requestId === sequence.current) setPending(false);
    }
  }, [apiClient, failure, from, policy, rangeKey, to]);

  const invalidate = useCallback(() => { ++sequence.current; }, []);

  useEffect(() => {
    if (!enabled) return;
    const timeout = window.setTimeout(() => void load(), 0);
    const reload = () => void load();
    window.addEventListener(TEAM_WORKWEEK_PUBLISHED_EVENT, reload);
    return () => {
      invalidate();
      window.clearTimeout(timeout);
      window.removeEventListener(TEAM_WORKWEEK_PUBLISHED_EVENT, reload);
    };
  }, [enabled, invalidate, load, today]);

  const nextActivationAt = snapshot?.nextActivationAt;
  useEffect(() => {
    if (!enabled || !nextActivationAt) return;
    let timeout: number;
    const refreshWhenActive = () => {
      const remaining = Date.parse(nextActivationAt) - Date.now() + 100;
      if (remaining > 0) {
        timeout = window.setTimeout(refreshWhenActive, Math.min(2_147_483_647, remaining));
      } else {
        setNow(new Date());
        void load();
      }
    };
    refreshWhenActive();
    return () => window.clearTimeout(timeout);
  }, [enabled, load, nextActivationAt]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  return { snapshot, hasLoadedRange: snapshot?.rangeKey === rangeKey, pending, message, load, now };
}
