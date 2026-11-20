"use client";

import { useEffect, useRef, useState } from "react";
import type { PlanningPromptTemplate, PlanningPromptTemplateAudience, PlanningPromptTemplateAudienceDirectory, PlanningPromptTemplateAudienceEdit, PlanningPromptTemplateEdit } from "@/features/planning-items/model/planning-prompt-templates";
import type { BrowserApiClient } from "@/lib/browser-api-client";
import { UiButton, UiEmptyState, UiNotice } from "@/shared/atoms/ui-primitives";
import { PlanningPromptTemplateAudienceEditor } from "../molecules/planning-prompt-template-audience-editor";
import { PlanningPromptTemplateEditor } from "../molecules/planning-prompt-template-editor";

const endpoint = "/api/administration/prompt-templates";
type Workspace = PlanningPromptTemplateAudienceDirectory & { templates: PlanningPromptTemplate[]; profileId: string };
type ApiError = { error?: string };

export function PlanningPromptTemplatesAdministration({ apiClient, onAdministratorAccessInvalid }: {
  apiClient: BrowserApiClient;
  onAdministratorAccessInvalid: () => void;
}) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [error, setError] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const writeRevision = useRef(0);

  useEffect(() => {
    const abort = new AbortController();
    const revisionAtLoad = writeRevision.current;
    async function load() {
      try {
        const { response, body } = await apiClient.requestJson<Workspace & ApiError>(endpoint, {
          signal: abort.signal,
          useDevProfileOverride: false,
        });
        if (abort.signal.aborted) return;
        if (response.status === 403) onAdministratorAccessInvalid();
        if (!response.ok || !body?.templates || !body.profileId || !body.audience || !body.profiles) throw new Error(body?.error);
        if (writeRevision.current !== revisionAtLoad) {
          // Reload after the write so the other templates and the audience can still refresh.
          setLoadAttempt(attempt => attempt + 1);
          return;
        }
        setWorkspace(body);
      } catch (failure) {
        if (!abort.signal.aborted) {
          setError(failure instanceof Error && failure.message || "Prompt-Vorlagen konnten nicht geladen werden.");
        }
      }
    }
    void load();
    return () => abort.abort();
  }, [apiClient, loadAttempt, onAdministratorAccessInvalid]);

  function reload() {
    setError("");
    setLoadAttempt(attempt => attempt + 1);
  }

  async function saveAudience(edit: PlanningPromptTemplateAudienceEdit) {
    const { response, body } = await apiClient.requestJson<{ audience?: PlanningPromptTemplateAudience } & ApiError>(endpoint, {
      method: "PATCH",
      json: edit,
      useDevProfileOverride: false,
    });
    if (response.status === 403) onAdministratorAccessInvalid();
    const audience = body?.audience;
    if (!response.ok || !audience) throw new Error(body?.error);
    writeRevision.current += 1;
    setWorkspace(current => current && { ...current, audience });
  }

  async function publish(edit: PlanningPromptTemplateEdit) {
    const { response, body } = await apiClient.requestJson<{ template?: PlanningPromptTemplate } & ApiError>(endpoint, {
      method: "PUT",
      json: edit,
      useDevProfileOverride: false,
    });
    if (response.status === 403) onAdministratorAccessInvalid();
    const published = body?.template;
    if (!response.ok || published?.kind !== edit.kind) {
      return { error: body?.error, conflict: response.status === 409 };
    }
    writeRevision.current += 1;
    setWorkspace(current => current && ({
      ...current,
      templates: current.templates.map(template => template.kind === published.kind ? published : template),
    }));
    return { published };
  }

  return (
    <div className="grid max-w-4xl gap-4">
      {error && (
        <UiNotice tone="warning" role="alert">
          <p>{error}</p>
          <UiButton className="mt-2 min-h-11" onClick={reload}>Erneut laden</UiButton>
        </UiNotice>
      )}
      {!workspace && !error && <UiEmptyState minHeight="md">Prompt-Vorlagen werden geladen.</UiEmptyState>}
      {workspace && (
        <PlanningPromptTemplateAudienceEditor
          key={workspace.profileId}
          audience={workspace.audience}
          profiles={workspace.profiles}
          onSave={saveAudience}
        />
      )}
      {workspace?.templates.map(template => (
        <PlanningPromptTemplateEditor
          key={`${workspace.profileId}:${template.kind}`}
          profileId={workspace.profileId}
          template={template}
          onReload={reload}
          onPublish={publish}
        />
      ))}
    </div>
  );
}
