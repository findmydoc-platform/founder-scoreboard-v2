"use client";

import { UiPanel } from "@/shared/atoms/ui-primitives";

export function SystemStatusSection({
  source,
  authAvailable,
  authUserEmail,
  githubAppConnected,
  googleChatReady,
}: {
  source: "seed" | "supabase";
  authAvailable: boolean;
  authUserEmail: string;
  githubAppConnected: boolean;
  googleChatReady: boolean;
}) {
  return (
    <UiPanel className="min-w-0">
      <h2 className="text-base font-semibold text-slate-950">Arbeitsbereitschaft</h2>
      <div className="mt-4 grid gap-3 text-sm">
        <div className="flex flex-col gap-1 rounded-md bg-slate-50 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-slate-500">Arbeitsmodus</span>
          <span className="min-w-0 whitespace-normal break-words font-semibold text-slate-900">{source === "supabase" ? "Teamdaten aktiv" : "Beispieldaten aktiv"}</span>
        </div>
        <div className="flex flex-col gap-1 rounded-md bg-slate-50 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-slate-500">Anmeldung</span>
          <span className="min-w-0 whitespace-normal break-words font-semibold text-slate-900 sm:max-w-48 sm:text-right">{authAvailable ? authUserEmail || "Bereit zum Anmelden" : "Nicht eingerichtet"}</span>
        </div>
        <div className="flex flex-col gap-1 rounded-md bg-slate-50 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-slate-500">GitHub-App</span>
          <span className={`min-w-0 whitespace-normal break-words font-semibold ${githubAppConnected ? "text-emerald-700" : "text-amber-700"}`}>
            {githubAppConnected ? "verbunden" : "Verbindung nötig"}
          </span>
        </div>
        <div className="flex flex-col gap-1 rounded-md bg-slate-50 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-slate-500">Benachrichtigungen</span>
          <span className={`min-w-0 whitespace-normal break-words font-semibold ${googleChatReady ? "text-emerald-700" : "text-amber-700"}`}>
            {googleChatReady ? "Zustellung aktiv" : "In der App gesammelt"}
          </span>
        </div>
      </div>
    </UiPanel>
  );
}
