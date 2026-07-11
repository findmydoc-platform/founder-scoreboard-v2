"use client";

import { CheckCircle2, Clipboard, KeyRound, RefreshCw, ShieldX } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { SettingsPane, SettingsRow } from "@/features/profile/molecules/profile-settings-layout";
import {
  createTeamIntakeToken,
  loadTeamIntakeTokens,
  revokeTeamIntakeToken,
  type TeamIntakeTokenRecord,
} from "@/features/profile/model/profile-team-intake-api";
import type { BrowserApiClient } from "@/lib/browser-api-client";
import { UiBadge, UiButton, UiNotice } from "@/shared/atoms/ui-primitives";

function formatDateTime(value: string) {
  if (!value) return "noch nie";
  return new Intl.DateTimeFormat("de-DE", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function tokenState(token: TeamIntakeTokenRecord) {
  if (token.revokedAt) return { label: "Widerrufen", tone: "red" as const };
  if (Date.parse(token.expiresAt) <= Date.now()) return { label: "Abgelaufen", tone: "amber" as const };
  return { label: "Aktiv", tone: "emerald" as const };
}

export function ProfileTeamIntakeTokens({
  apiClient,
  source,
}: {
  apiClient: BrowserApiClient;
  source: "seed" | "supabase";
}) {
  const [tokens, setTokens] = useState<TeamIntakeTokenRecord[]>([]);
  const [label, setLabel] = useState("");
  const [visibleToken, setVisibleToken] = useState("");
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"success" | "warning">("success");
  const [pending, setPending] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [renderedAt] = useState(() => Date.now());
  const activeTokens = useMemo(() => tokens.filter((token) => !token.revokedAt && Date.parse(token.expiresAt) > renderedAt), [renderedAt, tokens]);
  const canCreate = source === "supabase" && label.trim().length > 0 && activeTokens.length < 3 && !pending;

  const loadTokens = useCallback(async () => {
    if (source !== "supabase") return;
    setPending(true);
    setMessage("");
    try {
      const { response, body } = await loadTeamIntakeTokens(apiClient);
      if (!response.ok || !body?.tokens) throw new Error(body?.error || "Team-Intake-Tokens konnten nicht geladen werden.");
      setTokens(body.tokens);
      setLoaded(true);
    } catch (error) {
      setMessageTone("warning");
      setMessage(error instanceof Error ? error.message : "Team-Intake-Tokens konnten nicht geladen werden.");
    } finally {
      setPending(false);
    }
  }, [apiClient, source]);

  useEffect(() => {
    if (source !== "supabase") return;
    let active = true;
    void loadTeamIntakeTokens(apiClient)
      .then(({ response, body }) => {
        if (!active) return;
        if (!response.ok || !body?.tokens) throw new Error(body?.error || "Team-Intake-Tokens konnten nicht geladen werden.");
        setTokens(body.tokens);
        setLoaded(true);
      })
      .catch((error) => {
        if (!active) return;
        setMessageTone("warning");
        setMessage(error instanceof Error ? error.message : "Team-Intake-Tokens konnten nicht geladen werden.");
      });
    return () => {
      active = false;
    };
  }, [apiClient, source]);

  const createToken = async () => {
    if (!canCreate) return;
    setPending(true);
    setMessage("");
    setVisibleToken("");
    try {
      const { response, body } = await createTeamIntakeToken(apiClient, label.trim());
      if (!response.ok || !body?.token || !body.tokenRecord) throw new Error(body?.error || "Team-Intake-Token konnte nicht erstellt werden.");
      setTokens((current) => [body.tokenRecord!, ...current]);
      setVisibleToken(body.token);
      setLabel("");
      setMessageTone("success");
      setMessage("Token erstellt. Kopiere ihn jetzt; er wird nicht erneut angezeigt.");
    } catch (error) {
      setMessageTone("warning");
      setMessage(error instanceof Error ? error.message : "Team-Intake-Token konnte nicht erstellt werden.");
    } finally {
      setPending(false);
    }
  };

  const revokeToken = async (tokenId: string) => {
    setPending(true);
    setMessage("");
    try {
      const { response, body } = await revokeTeamIntakeToken(apiClient, tokenId);
      if (!response.ok || !body?.ok) throw new Error(body?.error || "Team-Intake-Token konnte nicht widerrufen werden.");
      setTokens((current) => current.map((token) => token.id === tokenId ? { ...token, revokedAt: new Date().toISOString() } : token));
      setVisibleToken("");
      setMessageTone("success");
      setMessage("Token widerrufen.");
    } catch (error) {
      setMessageTone("warning");
      setMessage(error instanceof Error ? error.message : "Team-Intake-Token konnte nicht widerrufen werden.");
    } finally {
      setPending(false);
    }
  };

  const copyToken = async () => {
    if (!visibleToken) return;
    try {
      await navigator.clipboard.writeText(visibleToken);
      setMessageTone("success");
      setMessage("Token kopiert.");
    } catch {
      setMessageTone("warning");
      setMessage("Token konnte nicht in die Zwischenablage kopiert werden.");
    }
  };

  return (
    <SettingsPane
      eyebrow="Persönlicher API-Zugang"
      title="Team Task Intake"
      description="Erstelle persönliche Tokens für externe Codex- oder ChatGPT-Clients. Sie dürfen task-zentrierten Kontext lesen sowie Vorschläge und zulässige Sub-Issues in deinem Namen einreichen."
    >
      {source !== "supabase" ? (
        <div className="px-5 py-5">
          <UiNotice tone="warning">Team-Intake-Tokens sind nur mit aktiver Supabase-Session verfügbar.</UiNotice>
        </div>
      ) : (
        <>
          <SettingsRow
            label="Neuen Token erstellen"
            description="Bezeichne den Client eindeutig. Pro Profil sind maximal drei aktive Tokens möglich; jedes Token läuft nach 90 Tagen ab."
            align="start"
          >
            <div className="grid min-w-0 gap-2 text-left md:min-w-80">
              <input
                value={label}
                onChange={(event) => setLabel(event.target.value.slice(0, 80))}
                placeholder="z. B. ChatGPT Aufgabenplanung"
                maxLength={80}
                disabled={pending || activeTokens.length >= 3}
                className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-50 disabled:text-slate-400"
                aria-label="Token-Bezeichnung"
              />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs text-slate-500">{activeTokens.length} von 3 aktiven Tokens</span>
                <UiButton onClick={createToken} disabled={!canCreate} variant="primary">
                  <KeyRound size={16} />
                  Token erstellen
                </UiButton>
              </div>
            </div>
          </SettingsRow>

          {visibleToken && (
            <div className="border-b border-emerald-100 bg-emerald-50 px-5 py-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="inline-flex items-center gap-2 text-sm font-semibold text-emerald-800">
                  <CheckCircle2 size={16} />
                  Einmalig sichtbarer Token
                </div>
                <UiButton onClick={copyToken} size="sm" variant="emerald">
                  <Clipboard size={15} />
                  Kopieren
                </UiButton>
              </div>
              <code className="mt-3 block overflow-x-auto rounded-md border border-emerald-100 bg-white px-3 py-2 text-xs text-slate-800">{visibleToken}</code>
            </div>
          )}

          {message && (
            <div className="border-b border-slate-100 px-5 py-3">
              <UiNotice tone={messageTone}>{message}</UiNotice>
            </div>
          )}

          <SettingsRow
            label="Persönliche Tokens"
            description="Widerrufe nicht mehr genutzte oder unbekannte Tokens sofort. Der vollständige Tokenwert ist nach der Erstellung nicht mehr abrufbar."
            align="start"
          >
            <div className="grid min-w-0 gap-2 text-left md:min-w-[32rem]">
              <div className="flex justify-end">
                <UiButton onClick={loadTokens} disabled={pending} size="sm" variant="secondary">
                  <RefreshCw size={15} />
                  Aktualisieren
                </UiButton>
              </div>
              {tokens.length ? tokens.map((token) => {
                const state = tokenState(token);
                return (
                  <div key={token.id} className="rounded-md border border-slate-200 px-3 py-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-slate-900">{token.label}</span>
                          <UiBadge tone={state.tone} size="xs">{state.label}</UiBadge>
                          <code className="text-xs text-slate-500">{token.tokenHint}</code>
                        </div>
                        <div className="mt-1 text-xs leading-5 text-slate-500">
                          Erstellt {formatDateTime(token.createdAt)} · Läuft ab {formatDateTime(token.expiresAt)} · Zuletzt genutzt {formatDateTime(token.lastUsedAt)}
                        </div>
                      </div>
                      {!token.revokedAt && Date.parse(token.expiresAt) > renderedAt && (
                        <UiButton onClick={() => revokeToken(token.id)} disabled={pending} size="sm" variant="red">
                          <ShieldX size={15} />
                          Widerrufen
                        </UiButton>
                      )}
                    </div>
                  </div>
                );
              }) : loaded ? (
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
