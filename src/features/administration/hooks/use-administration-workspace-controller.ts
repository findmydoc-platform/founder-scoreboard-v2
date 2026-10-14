"use client";

import { useCallback, useEffect, useState } from "react";
import type { AuthorityCapabilities } from "@/features/administrator-access/model/administrator-access";
import type { AdministrationProfile, AdministrationWorkspaceModel, PersonAdministrationPatch } from "@/features/administration/model/administration-read-model";
import type { BrowserApiClient } from "@/lib/browser-api-client";

type ErrorBody = { error?: string; code?: string };

export function useAdministrationWorkspaceController({
  apiClient,
  capabilities,
  initialModel = null,
  onAdministratorAccessInvalid,
}: {
  apiClient: BrowserApiClient;
  capabilities: AuthorityCapabilities;
  initialModel?: AdministrationWorkspaceModel | null;
  onAdministratorAccessInvalid: () => void;
}) {
  const [model, setModel] = useState<AdministrationWorkspaceModel | null>(initialModel);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const handleAccessError = useCallback((body?: ErrorBody | null) => {
    if (body?.code !== "administrator_access_required" && body?.code !== "administrator_access_expired") return false;
    setModel(null);
    onAdministratorAccessInvalid();
    return true;
  }, [onAdministratorAccessInvalid]);

  const load = useCallback(async () => {
    if (!capabilities.manageAdministratorEligibility) {
      setModel(null);
      return null;
    }
    const { response, body } = await apiClient.requestJson<{
      administration?: AdministrationWorkspaceModel;
      error?: string;
      code?: string;
    }>("/api/administration-data", { useDevProfileOverride: false });
    if (response.ok && body?.administration) {
      setModel(body.administration);
      setMessage("");
      return body.administration;
    }
    handleAccessError(body);
    setMessage(body?.error || "Administrationsdaten konnten nicht geladen werden.");
    return null;
  }, [apiClient, capabilities.manageAdministratorEligibility, handleAccessError]);

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

  const savePerson = useCallback(async (
    person: AdministrationProfile,
    patch: PersonAdministrationPatch,
  ) => {
    const technicalChanged = capabilities.technicalAdministration && (
      person.githubLogin !== patch.technicalIdentity.githubLogin
      || person.googleChatUserId !== patch.technicalIdentity.googleChatUserId
      || person.googleChatDmSpace !== patch.technicalIdentity.googleChatDmSpace
    );
    const eligibilityChanged = person.administratorAccess.eligible !== patch.eligible;
    if (!technicalChanged && !eligibilityChanged) return;

    setBusy(true);
    setMessage("");
    let technicalSaved = false;
    try {
      if (technicalChanged) {
        const { response, body } = await apiClient.requestJson<ErrorBody>(`/api/administration/profiles/${encodeURIComponent(person.id)}/technical`, {
          method: "PATCH",
          json: patch.technicalIdentity,
          useDevProfileOverride: false,
        });
        if (!response.ok) {
          handleAccessError(body);
          throw new Error(body?.error || "Technische Identität konnte nicht gespeichert werden.");
        }
        technicalSaved = true;
      }

      if (eligibilityChanged) {
        const { response, body } = await apiClient.requestJson<ErrorBody>(`/api/administrator-access/profiles/${encodeURIComponent(person.id)}`, {
          method: "PATCH",
          json: { eligible: patch.eligible },
          useDevProfileOverride: false,
        });
        if (!response.ok) {
          handleAccessError(body);
          const detail = body?.error || "Adminberechtigung konnte nicht gespeichert werden.";
          throw new Error(technicalSaved ? `Technische Identität wurde gespeichert. ${detail}` : detail);
        }
      }

      await load();
    } catch (error) {
      await load();
      setMessage(error instanceof Error ? error.message : "Personenzugang konnte nicht gespeichert werden.");
      throw error;
    } finally {
      setBusy(false);
    }
  }, [apiClient, capabilities.technicalAdministration, handleAccessError, load]);

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

  useEffect(() => {
    if (!capabilities.manageAdministratorEligibility) {
      window.queueMicrotask(() => setModel(null));
      return;
    }
    if (!capabilities.technicalAdministration) {
      window.queueMicrotask(() => setModel(null));
    }
    window.queueMicrotask(() => void load());
  }, [capabilities.manageAdministratorEligibility, capabilities.technicalAdministration, load]);

  return {
    busy,
    capabilities,
    deliverNotifications,
    load,
    message,
    model,
    saveGitHubProject,
    savePerson,
  };
}
