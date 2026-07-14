"use client";

import { CheckCircle2, Clipboard, KeyRound, RefreshCw } from "lucide-react";
import type { BrowserApiClient } from "@/lib/browser-api-client";
import {
  TEAM_PLANNING_ITEMS_MAX_ACTIVE_TOKENS,
  TEAM_PLANNING_ITEMS_TOKEN_TTL_DAYS,
} from "@/features/planning-items/model/planning-items-contract";
import { useProfilePlanningItemsTokens } from "@/features/profile/hooks/use-profile-planning-items-tokens";
import { SettingsPane, SettingsRow, ToggleSwitch } from "@/features/profile/molecules/profile-settings-layout";
import { ProfilePlanningItemsTokenRow } from "@/features/profile/molecules/profile-planning-items-token-row";
import { UiButton, UiNotice } from "@/shared/atoms/ui-primitives";

export function ProfilePlanningItemsTokens({
  apiClient,
  source,
}: {
  apiClient: BrowserApiClient;
  source: "seed" | "supabase";
}) {
  const tokens = useProfilePlanningItemsTokens({ apiClient, source });

  return (
    <SettingsPane
      eyebrow="Persönlicher API-Zugang"
      title="Team-Planungs-API"
      description="Erstelle persönliche Tokens für externe Codex- oder ChatGPT-Clients. Sie lesen den Planungskontext und erstellen Planungselemente in deinem Namen. Bestehende Elemente bleiben ohne ausdrückliche Freigabe unveränderbar."
    >
      {source !== "supabase" ? (
        <div className="px-5 py-5">
          <UiNotice tone="warning">Planning-API-Tokens sind nur mit aktiver Supabase-Session verfügbar.</UiNotice>
        </div>
      ) : (
        <>
          <SettingsRow
            label="Neuen Token erstellen"
            description={`Bezeichne den Client eindeutig. Pro Profil sind maximal ${TEAM_PLANNING_ITEMS_MAX_ACTIVE_TOKENS} aktive Tokens möglich; jedes Token läuft nach ${TEAM_PLANNING_ITEMS_TOKEN_TTL_DAYS} Tagen ab.`}
            align="start"
          >
            <div className="grid min-w-0 gap-3 text-left md:min-w-80">
              <input
                value={tokens.label}
                onChange={(event) => tokens.setLabel(event.target.value.slice(0, 80))}
                placeholder="z. B. ChatGPT Planungs-API"
                maxLength={80}
                disabled={tokens.pending || tokens.activeTokenCount >= TEAM_PLANNING_ITEMS_MAX_ACTIVE_TOKENS}
                className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-50 disabled:text-slate-400"
                aria-label="Token-Bezeichnung"
              />
              <div className="flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                <div>
                  <div className="text-sm font-medium text-slate-900">Bestehende Planungselemente bearbeiten</div>
                  <div className="text-xs leading-5 text-slate-500">Aktiviert den separaten Update-Scope für diesen neuen Token.</div>
                </div>
                <ToggleSwitch
                  checked={tokens.allowUpdates}
                  disabled={tokens.pending || tokens.activeTokenCount >= TEAM_PLANNING_ITEMS_MAX_ACTIVE_TOKENS}
                  label="Bestehende Planungselemente bearbeiten"
                  onChange={tokens.setAllowUpdates}
                />
              </div>
              {tokens.canIssueEmptyMilestoneDeletes && (
                <div className="flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                  <div>
                    <div className="text-sm font-medium text-slate-900">Leere Meilensteine löschen</div>
                    <div className="text-xs leading-5 text-slate-500">Erlaubt nur das Löschen eines Meilensteins ohne zugeordnete Initiativen oder Aufgaben.</div>
                  </div>
                  <ToggleSwitch
                    checked={tokens.allowEmptyMilestoneDeletes}
                    disabled={tokens.pending || tokens.activeTokenCount >= TEAM_PLANNING_ITEMS_MAX_ACTIVE_TOKENS}
                    label="Leere Meilensteine löschen"
                    onChange={tokens.setAllowEmptyMilestoneDeletes}
                  />
                </div>
              )}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs text-slate-500">{tokens.activeTokenCount} von {TEAM_PLANNING_ITEMS_MAX_ACTIVE_TOKENS} aktiven Tokens</span>
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
            description="Alle aktiven Tokens bleiben sichtbar und widerrufbar. Die Berechtigungen zeigen, ob ein Token lesen, erstellen, aktualisieren oder leere Meilensteine löschen darf."
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
                <ProfilePlanningItemsTokenRow
                  key={token.id}
                  currentTime={tokens.currentTime}
                  onRevoke={tokens.revokeToken}
                  pending={tokens.pending}
                  token={token}
                />
              )) : tokens.loaded ? (
                <div className="rounded-md border border-dashed border-slate-200 px-3 py-4 text-sm text-slate-500">Noch kein persönlicher Planning-API-Token.</div>
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
