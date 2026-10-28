"use client";

import { useCallback, useEffect, useReducer, useState } from "react";
import type { AuthorityCapabilities } from "@/features/administrator-access/model/administrator-access";
import type { AdministrationWorkspaceModel } from "@/features/administration/model/administration-read-model";
import type { BrowserApiClient } from "@/lib/browser-api-client";

type ErrorBody = { error?: string; code?: string };

export function useAdministrationWorkspaceController({
  apiClient,
  planningState,
  capabilities,
  onAdministratorAccessInvalid,
}: {
  apiClient: BrowserApiClient;
  planningState: import("@/features/planning/model/planning-state").PlanningState;
  capabilities: AuthorityCapabilities;
  initialModel?: AdministrationWorkspaceModel | null;
  onAdministratorAccessInvalid: () => void;
}) {
  const [, publish] = useReducer(value => value + 1, 0);
  useEffect(() => planningState.subscribe(publish), [planningState]);
  const model = planningState.administration().model;
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const handleAccessError = useCallback((body?: ErrorBody | null) => {
    if (body?.code !== "administrator_access_required" && body?.code !== "administrator_access_expired") return false;

    onAdministratorAccessInvalid();
    return true;
  }, [onAdministratorAccessInvalid]);

  const load = useCallback(async () => {
    const loaded = await planningState.loadAdministration();
    const state = planningState.administration();
    if (!loaded) {
      if (state.readStatus === "forbidden") onAdministratorAccessInvalid();
      setMessage(state.readStatus === "forbidden" ? "Der Administrationszugang ist nicht mehr gültig." : "Administrationsdaten konnten nicht geladen werden.");
    } else setMessage("");
    return loaded ? state.model : null;
  }, [planningState, onAdministratorAccessInvalid]);

  const runCommand = useCallback(async <Body extends ErrorBody>(
    request: () => Promise<{ response: Response; body: Body | null }>,
    fallback: string,
  ) => {
    setBusy(true);
    setMessage("");
    try {
      const { response, body } = await request();
      if (!response.ok) {
        handleAccessError(body);
        throw new Error(body?.error || fallback);
      }
      await load();
      return body;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : fallback);
      throw error;
    } finally {
      setBusy(false);
    }
  }, [handleAccessError, load]);

  const saveGitHubProject = useCallback(async (owner: string, number: number, mentionTeamSlug: string) => {
    const current = model?.githubProject;
    if (!current) return;
    await runCommand(
      () => apiClient.requestJson<ErrorBody>("/api/founderops-settings/github-project", {
        method: "PATCH",
        json: {
          expectedGithubProjectOwner: current.owner,
          expectedGithubProjectNumber: current.number,
          expectedGithubMentionTeamSlug: current.mentionTeamSlug,
          githubProjectOwner: owner,
          githubProjectNumber: number,
          githubMentionTeamSlug: mentionTeamSlug,
        },
        useDevProfileOverride: false,
      }),
      "GitHub Project konnte nicht gespeichert werden.",
    );
  }, [apiClient, model?.githubProject, runCommand]);

  const deliverNotifications = useCallback(async (payload: Record<string, unknown>) => {
    await runCommand(
      () => apiClient.requestJson<ErrorBody>("/api/notifications/deliver", {
        method: "POST",
        json: payload,
        useDevProfileOverride: false,
      }),
      "Zustellung konnte nicht ausgeführt werden.",
    );
    setMessage("Zustellung abgeschlossen.");
  }, [apiClient, runCommand]);

  useEffect(() => { window.queueMicrotask(() => void load()); }, [load]);

  return {
    busy,
    capabilities,
    deliverNotifications,
    load,
    message,
    model,
    saveGitHubProject,
    planningState,
  };
}
