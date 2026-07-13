"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BrowserApiClient } from "@/lib/browser-api-client";
import {
  TEAM_PLANNING_ITEMS_MAX_ACTIVE_TOKENS,
  type TeamPlanningItemTokenRecord,
} from "@/features/planning-items/model/planning-items-contract";
import {
  createPlanningItemsToken,
  loadPlanningItemsTokens,
  revokePlanningItemsToken,
} from "@/features/profile/model/profile-planning-items-api";

export function useProfilePlanningItemsTokens({
  apiClient,
  source,
}: {
  apiClient: BrowserApiClient;
  source: "seed" | "supabase";
}) {
  const mounted = useRef(true);
  const [tokens, setTokens] = useState<TeamPlanningItemTokenRecord[]>([]);
  const [label, setLabel] = useState("");
  const [allowUpdates, setAllowUpdates] = useState(false);
  const [visibleToken, setVisibleToken] = useState("");
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"success" | "warning">("success");
  const [pending, setPending] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [currentTime, setCurrentTime] = useState(() => Date.now());
  const activeTokens = useMemo(
    () => tokens.filter((token) => !token.revokedAt && Date.parse(token.expiresAt) > currentTime),
    [currentTime, tokens],
  );
  const canCreate = source === "supabase"
    && label.trim().length > 0
    && activeTokens.length < TEAM_PLANNING_ITEMS_MAX_ACTIVE_TOKENS
    && !pending;

  useEffect(() => {
    mounted.current = true;
    const interval = window.setInterval(() => setCurrentTime(Date.now()), 60_000);
    return () => {
      mounted.current = false;
      window.clearInterval(interval);
    };
  }, []);

  const loadTokens = useCallback(async () => {
    if (source !== "supabase") return;
    setPending(true);
    setMessage("");
    try {
      const { response, body } = await loadPlanningItemsTokens(apiClient);
      if (!response.ok || !body?.tokens) throw new Error(body?.error || "Planning-API-Tokens konnten nicht geladen werden.");
      if (!mounted.current) return;
      setTokens(body.tokens);
      setLoaded(true);
    } catch (error) {
      if (!mounted.current) return;
      setMessageTone("warning");
      setMessage(error instanceof Error ? error.message : "Planning-API-Tokens konnten nicht geladen werden.");
    } finally {
      if (mounted.current) setPending(false);
    }
  }, [apiClient, source]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void loadTokens(), 0);
    return () => window.clearTimeout(timeout);
  }, [loadTokens]);

  const createToken = async () => {
    if (!canCreate) return;
    setPending(true);
    setMessage("");
    setVisibleToken("");
    try {
      const { response, body } = await createPlanningItemsToken(apiClient, label.trim(), allowUpdates);
      if (!response.ok || !body?.token || !body.tokenRecord) throw new Error(body?.error || "Planning-API-Token konnte nicht erstellt werden.");
      setTokens((current) => [body.tokenRecord!, ...current]);
      setVisibleToken(body.token);
      setLabel("");
      setAllowUpdates(false);
      setMessageTone("success");
      setMessage("Token erstellt. Kopiere ihn jetzt; er wird nicht erneut angezeigt.");
    } catch (error) {
      setMessageTone("warning");
      setMessage(error instanceof Error ? error.message : "Planning-API-Token konnte nicht erstellt werden.");
    } finally {
      setPending(false);
    }
  };

  const revokeToken = async (tokenId: string) => {
    setPending(true);
    setMessage("");
    try {
      const { response, body } = await revokePlanningItemsToken(apiClient, tokenId);
      if (!response.ok || !body?.ok) throw new Error(body?.error || "Planning-API-Token konnte nicht widerrufen werden.");
      setTokens((current) => current.map((token) => token.id === tokenId ? { ...token, revokedAt: new Date().toISOString() } : token));
      setVisibleToken("");
      setMessageTone("success");
      setMessage("Token widerrufen.");
    } catch (error) {
      setMessageTone("warning");
      setMessage(error instanceof Error ? error.message : "Planning-API-Token konnte nicht widerrufen werden.");
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

  return {
    activeTokenCount: activeTokens.length,
    allowUpdates,
    canCreate,
    copyToken,
    createToken,
    currentTime,
    label,
    loaded,
    loadTokens,
    message,
    messageTone,
    pending,
    revokeToken,
    setAllowUpdates,
    setLabel,
    tokens,
    visibleToken,
  };
}
