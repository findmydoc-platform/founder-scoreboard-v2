"use client";

import { TEAM_WORKWEEK_PUBLISHED_EVENT } from "@/features/team-workweek/model/published-workweek-events";

import { createBrowserSessionAdapter, type BrowserSessionSnapshot } from "@/lib/credentials/browser";
import { emptyPlanningShellState } from "../planning-shell-state";
import { createBrowserPlanningState, type BrowserPlanningState, type PlanningPageState } from "./browser-planning-state";

type SessionSource = Pick<ReturnType<typeof createBrowserSessionAdapter>, "current" | "subscribe">;

// The root client boundary owns this object. Server rendering creates only a request-local instance.
export function createBrowserPlanningLifetime(sessions: SessionSource = createBrowserSessionAdapter()) {
  let current: BrowserPlanningState | undefined;
  let session: BrowserSessionSnapshot | null | undefined;
  let generation = 0;
  let expiry: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<() => void>();
  const emit = () => { listeners.forEach(listener => listener()); };
  function clearCurrent() {
    if (current) current.owner.internal.endSession();
    generation++;
    current = undefined;
  }
  function acceptSession(next: BrowserSessionSnapshot | null) {
    if (expiry) clearTimeout(expiry);
    const replaced = session !== undefined && (!next || session?.userId !== next.userId);
    if (replaced || (current && current.runtime.userId !== next?.userId)) clearCurrent();
    session = next;
    if (next) {
      if (next.expiresAt * 1000 <= Date.now()) { clearCurrent(); session = null; }
      else {
        if (current) { current.runtime.session = next; current.owner.internal.bindSession(next); }
        expiry = setTimeout(() => { session = null; clearCurrent(); emit(); }, Math.max(0, next.expiresAt * 1000 - Date.now()));
      }
    }
    emit();
  }
  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    page(options: PlanningPageState) {
      const permitted = Boolean(options.initialUserId) && (session === undefined || session?.userId === options.initialUserId);
      if (!permitted) return undefined;
      if (!current || current.runtime.userId !== options.initialUserId) {
        if (current) clearCurrent();
        const started = generation;
        current = createBrowserPlanningState(options, () => started === generation);
        if (session) { current.runtime.session = session; current.owner.internal.bindSession(session); }
        return current;
      }
      return current;
    },
    empty(options: PlanningPageState) {
      return createBrowserPlanningState({ ...options, initialUserId: "", initialData: emptyPlanningShellState }, () => false);
    },
    connect() {
      let active = true;
      let received = false;
      const refreshCalendars = () => current?.owner.internal.invalidatePublishedWorkweeks();
      if (typeof window !== "undefined") window.addEventListener(TEAM_WORKWEEK_PUBLISHED_EVENT, refreshCalendars);
      const unsubscribe = sessions.subscribe(next => { if (active) { received = true; acceptSession(next); } });
      void sessions.current().then(next => { if (active && !received) acceptSession(next); }).catch(() => undefined);
      return () => { active = false; if (typeof window !== "undefined") window.removeEventListener(TEAM_WORKWEEK_PUBLISHED_EVENT, refreshCalendars); unsubscribe(); if (expiry) clearTimeout(expiry); };
    },
  };
}

export type BrowserPlanningLifetime = ReturnType<typeof createBrowserPlanningLifetime>;
