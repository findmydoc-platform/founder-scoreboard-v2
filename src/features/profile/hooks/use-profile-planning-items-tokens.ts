"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { TEAM_PLANNING_ITEMS_MAX_ACTIVE_TOKENS } from "@/features/planning-items/model/planning-items-contract";
import type { PlanningState } from "@/features/planning/model/planning-state";

export function useProfilePlanningItemsTokens({ planningState }: { planningState: PlanningState }) {
  const mounted = useRef(false);
  const view = useSyncExternalStore(planningState.subscribe, planningState.profileApiTokens, planningState.profileApiTokens);
  const [label, setLabel] = useState("");
  const [allowUpdates, setAllowUpdates] = useState(false);
  const [allowEmptyEpicDeletes, setAllowEmptyEpicDeletes] = useState(false);
  const [allowGitHubSync, setAllowGitHubSync] = useState(false);
  const [tokenPresentation, setTokenPresentation] = useState<{ owner: PlanningState; token: string } | null>(null);
  const visibleToken = tokenPresentation?.owner === planningState && view.readStatus !== "forbidden" && view.readStatus !== "not-loaded" ? tokenPresentation.token : "";
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"success" | "warning">("success");
  const [currentTime, setCurrentTime] = useState(() => Date.now());
  const activeTokens = useMemo(() => view.tokens.filter(token => !token.revokedAt && Date.parse(token.expiresAt) > currentTime), [currentTime, view.tokens]);
  const pending = view.readStatus === "loading" || view.operations.some(operation => operation.phase === "saving");
  const uncertainIssue = view.operations.some(operation => operation.action === "issue" && operation.phase === "unconfirmed");
  const canCreate = label.trim().length > 0 && activeTokens.length < TEAM_PLANNING_ITEMS_MAX_ACTIVE_TOKENS && !pending && !uncertainIssue && view.readStatus !== "forbidden" && view.readStatus !== "not-loaded";
  useEffect(() => {
    mounted.current = true;
    const interval = window.setInterval(() => setCurrentTime(Date.now()), 60_000);
    const unsubscribe = planningState.subscribe(() => {
      const current = planningState.profileApiTokens();
      if (current.readStatus === "not-loaded" || current.readStatus === "forbidden") setTokenPresentation(null);
    });
    const timeout = window.setTimeout(() => void planningState.loadProfileApiTokens(), 0);
    return () => { mounted.current = false; unsubscribe(); window.clearInterval(interval); window.clearTimeout(timeout); };
  }, [planningState]);
  const loadTokens = useCallback(async () => { await planningState.loadProfileApiTokens(); }, [planningState]);
  const createToken = async () => {
    if (!canCreate) return;
    setTokenPresentation(null);
    setMessage("");
    const result = await planningState.issueProfileApiToken({ label: label.trim(), allowUpdates, allowEmptyEpicDeletes: view.canIssueEmptyEpicDeletes && allowEmptyEpicDeletes, allowGitHubSync });
    if (!mounted.current) return;
    if (!result.ok) { setMessageTone("warning"); setMessage(result.error); return; }
    setTokenPresentation({ owner: planningState, token: result.token });
    setLabel(""); setAllowUpdates(false); setAllowEmptyEpicDeletes(false); setAllowGitHubSync(false);
    setMessageTone("success"); setMessage("Token erstellt. Kopiere ihn jetzt; er wird nicht erneut angezeigt.");
  };
  const revokeToken = async (tokenId: string) => {
    setTokenPresentation(null); setMessage("");
    const result = await planningState.revokeProfileApiToken(tokenId);
    if (!mounted.current) return;
    setMessageTone(result.ok ? "success" : "warning");
    setMessage(result.ok ? "Token widerrufen." : result.error);
  };
  const copyToken = async () => {
    if (!visibleToken) return;
    try { await navigator.clipboard.writeText(visibleToken); setMessageTone("success"); setMessage("Token kopiert."); }
    catch { setMessageTone("warning"); setMessage("Token konnte nicht in die Zwischenablage kopiert werden."); }
  };
  const uncertain = view.operations.find(operation => operation.phase === "unconfirmed");
  return { activeTokenCount: activeTokens.length, allowEmptyEpicDeletes, allowGitHubSync, allowUpdates, canIssueEmptyEpicDeletes: view.canIssueEmptyEpicDeletes, canCreate, copyToken, createToken, currentTime, label, loaded: view.readStatus !== "not-loaded", loadTokens, message: uncertain?.error || message || (view.readStatus === "unavailable" ? "Die Token-Liste konnte nicht geladen werden." : view.readStatus === "forbidden" ? "API-Tokens sind nicht verfügbar." : ""), messageTone: uncertain || view.readStatus === "unavailable" || view.readStatus === "forbidden" ? "warning" as const : messageTone, pending, revokeToken, setAllowUpdates, setAllowEmptyEpicDeletes, setAllowGitHubSync, setLabel, tokens: view.tokens, visibleToken };
}
