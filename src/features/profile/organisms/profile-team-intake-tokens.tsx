"use client";

import { CheckCircle2, Clipboard, KeyRound, RefreshCw } from "lucide-react";
import type { BrowserApiClient } from "@/lib/browser-api-client";
import {
  TEAM_TASK_INTAKE_MAX_ACTIVE_TOKENS,
  TEAM_TASK_INTAKE_TOKEN_TTL_DAYS,
} from "@/features/intake/model/team-task-intake-contract";
import { useProfileTeamIntakeTokens } from "@/features/profile/hooks/use-profile-team-intake-tokens";
import { SettingsPane, SettingsRow } from "@/features/profile/molecules/profile-settings-layout";
import { ProfileTeamIntakeTokenRow } from "@/features/profile/molecules/profile-team-intake-token-row";
import { UiButton, UiNotice } from "@/shared/atoms/ui-primitives";

export function ProfileTeamIntakeTokens({
  apiClient,
  source,
}: {
  apiClient: BrowserApiClient;
  source: "seed" | "supabase";
}) {
  const tokens = useProfileTeamIntakeTokens({ apiClient, source });

  return (
    <SettingsPane
      eyebrow="Persönlicher API-Zugang"
      title="Team Task Intake"
      description="Erstelle persönliche Tokens für externe Codex- oder ChatGPT-Clients. Sie dürfen den vollständigen task-zentrierten Team-Kontext lesen sowie Vorschläge und zulässige Sub-Issues in deinem Namen einreichen."
    >
      {source !== "supabase" ? (
        <div className="px-5 py-5">
          <UiNotice tone="warning">Team-Intake-Tokens sind nur mit aktiver Supabase-Session verfügbar.</UiNotice>
        </div>
      ) : (
        <>
          <SettingsRow
            label="Neuen Token erstellen"
            description={`Bezeichne den Client eindeutig. Pro Profil sind maximal ${TEAM_TASK_INTAKE_MAX_ACTIVE_TOKENS} aktive Tokens möglich; jedes Token läuft nach ${TEAM_TASK_INTAKE_TOKEN_TTL_DAYS} Tagen ab.`}
            align="start"
          >
            <div className="grid min-w-0 gap-2 text-left md:min-w-80">
              <input
                value={tokens.label}
                onChange={(event) => tokens.setLabel(event.target.value.slice(0, 80))}
                placeholder="z. B. ChatGPT Aufgabenplanung"
                maxLength={80}
                disabled={tokens.pending || tokens.activeTokenCount >= TEAM_TASK_INTAKE_MAX_ACTIVE_TOKENS}
                className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-50 disabled:text-slate-400"
                aria-label="Token-Bezeichnung"
              />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs text-slate-500">{tokens.activeTokenCount} von {TEAM_TASK_INTAKE_MAX_ACTIVE_TOKENS} aktiven Tokens</span>
                <UiButton onClick={tokens.createToken} disabled={!tokens.canCreate} variant="primary">
                  <KeyRound size={16} />
                  Token erstellen
                </UiButton>
              </div>
            </div>
          </SettingsRow>

          {tokens.visibleToken && (
            <div className="border-b border-emerald-100 bg-emerald-50 px-5 py-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="inline-flex items-center gap-2 text-sm font-semibold text-emerald-800">
                  <CheckCircle2 size={16} />
                  Einmalig sichtbarer Token
                </div>
                <UiButton onClick={tokens.copyToken} size="sm" variant="emerald">
                  <Clipboard size={15} />
                  Kopieren
                </UiButton>
              </div>
              <code className="mt-3 block overflow-x-auto rounded-md border border-emerald-100 bg-white px-3 py-2 text-xs text-slate-800">{tokens.visibleToken}</code>
            </div>
          )}

          {tokens.message && (
            <div className="border-b border-slate-100 px-5 py-3">
              <UiNotice tone={tokens.messageTone}>{tokens.message}</UiNotice>
            </div>
          )}

          <SettingsRow
            label="Persönliche Tokens"
            description="Alle aktiven Tokens bleiben sichtbar und widerrufbar. Zusätzlich werden die zuletzt abgelaufenen oder widerrufenen Tokens angezeigt."
            align="start"
          >
            <div className="grid min-w-0 gap-2 text-left md:min-w-[32rem]">
              <div className="flex justify-end">
                <UiButton onClick={tokens.loadTokens} disabled={tokens.pending} size="sm" variant="secondary">
                  <RefreshCw size={15} />
                  Aktualisieren
                </UiButton>
              </div>
              {tokens.tokens.length ? tokens.tokens.map((token) => (
                <ProfileTeamIntakeTokenRow
                  key={token.id}
                  currentTime={tokens.currentTime}
                  onRevoke={tokens.revokeToken}
                  pending={tokens.pending}
                  token={token}
                />
              )) : tokens.loaded ? (
                <div className="rounded-md border border-dashed border-slate-200 px-3 py-4 text-sm text-slate-500">Noch kein persönlicher Team-Intake-Token.</div>
              ) : (
                <div className="rounded-md border border-dashed border-slate-200 px-3 py-4 text-sm text-slate-500">Tokens werden geladen.</div>
              )}
            </div>
          </SettingsRow>
        </>
      )}
    </SettingsPane>
  );
}
