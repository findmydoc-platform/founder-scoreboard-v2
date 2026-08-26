"use client";

import { CalendarDays } from "lucide-react";
import dynamic from "next/dynamic";
import { createPortal } from "react-dom";
import { useTeamWorkweekQuickView } from "../hooks/use-team-workweek-quick-view";
import type { BrowserApiClient } from "@/lib/browser-api-client";
import type { Profile } from "@/lib/types";

const TeamWorkweekQuickViewDialog = dynamic(() =>
  import("../organisms/team-workweek-quick-view-dialog").then(
    (module) => module.TeamWorkweekQuickViewDialog,
  ),
);

export function HeaderTeamWorkweekAction({
  apiClient,
  onOpenTeam,
  profiles,
}: {
  apiClient: BrowserApiClient;
  onOpenTeam: () => void;
  profiles: Profile[];
}) {
  const state = useTeamWorkweekQuickView(apiClient, onOpenTeam);

  return (
    <>
      <button
        type="button"
        onClick={state.openQuickView}
        aria-haspopup="dialog"
        aria-expanded={state.open}
        className="grid h-9 w-9 place-items-center rounded-md border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
        aria-label="Team-Arbeitswoche öffnen"
      >
        <CalendarDays size={16} aria-hidden="true" />
      </button>
      {state.open && typeof document !== "undefined"
        ? createPortal(
          <TeamWorkweekQuickViewDialog
            message={state.message}
            onClose={state.closeQuickView}
            onOpenTeam={state.openTeamWorkspace}
            pending={state.pending}
            profiles={profiles}
            workweeks={state.workweeks}
          />,
          document.body,
        )
        : null}
    </>
  );
}
