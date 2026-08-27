"use client";

import { CalendarDays } from "lucide-react";
import dynamic from "next/dynamic";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useRef, useState } from "react";
import { useHeaderCalendar } from "../hooks/use-header-calendar";
import type { BrowserApiClient } from "@/lib/browser-api-client";
import type { HeaderCalendarEvent, HeaderDataSlot, Profile } from "@/lib/types";

const HeaderCalendarDialog = dynamic(() =>
  import("../organisms/header-calendar-dialog").then((module) => module.HeaderCalendarDialog),
);

export function HeaderCalendarAction({
  apiClient,
  events,
  onOpenTeam,
  profiles,
}: {
  apiClient?: BrowserApiClient;
  events: HeaderDataSlot<HeaderCalendarEvent[]>;
  onOpenTeam: () => void;
  profiles: Profile[];
}) {
  const state = useHeaderCalendar({ apiClient, onOpenTeam });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [anchor, setAnchor] = useState<{ right: number; top: number } | null>(null);
  const [desktopPopover, setDesktopPopover] = useState(false);

  const updateAnchor = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setDesktopPopover(window.matchMedia("(min-width: 1024px)").matches);
    setAnchor({
      right: Math.max(12, window.innerWidth - rect.right),
      top: rect.bottom + 8,
    });
  }, []);

  useEffect(() => {
    if (!state.open) return;
    const passiveCapture = { capture: true, passive: true } as const;
    const passive = { passive: true } as const;
    window.addEventListener("resize", updateAnchor);
    window.addEventListener("scroll", updateAnchor, passiveCapture);
    window.visualViewport?.addEventListener("resize", updateAnchor);
    window.visualViewport?.addEventListener("scroll", updateAnchor, passive);
    return () => {
      window.removeEventListener("resize", updateAnchor);
      window.removeEventListener("scroll", updateAnchor, passiveCapture);
      window.visualViewport?.removeEventListener("resize", updateAnchor);
      window.visualViewport?.removeEventListener("scroll", updateAnchor);
    };
  }, [state.open, updateAnchor]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        data-tour-id="header-calendar-action"
        onClick={() => {
          updateAnchor();
          state.openCalendar();
        }}
        aria-haspopup="dialog"
        aria-expanded={state.open}
        aria-label="Kalender öffnen"
        className="relative grid h-9 w-9 place-items-center rounded-md border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
      >
        <CalendarDays size={16} aria-hidden="true" />
      </button>
      {state.open && typeof document !== "undefined" ? createPortal(
        <HeaderCalendarDialog
          activeTab={state.activeTab}
          anchor={anchor}
          calendarWorkweeks={state.calendarWorkweeks}
          desktopPopover={desktopPopover}
          eventSlot={events}
          message={state.message}
          now={state.now}
          onActiveTabChange={state.setActiveTab}
          onClose={state.closeCalendar}
          onOpenTeam={state.openTeamWorkspace}
          onSelectedDateChange={state.setSelectedDate}
          onViewMonthChange={state.setViewMonth}
          pending={state.pending}
          profiles={profiles}
          restoreFocusRef={triggerRef}
          selectedDate={state.selectedDate}
          showWorkweek={Boolean(apiClient)}
          viewMonth={state.viewMonth}
          workweeks={state.workweeks}
        />,
        document.body,
      ) : null}
    </>
  );
}
