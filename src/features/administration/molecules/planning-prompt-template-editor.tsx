"use client";

import { useId, useState } from "react";
import type { PlanningPromptTemplate, PlanningPromptTemplateEdit } from "@/features/planning-items/model/planning-prompt-templates";
import { UiButton, UiNotice, UiPanel, UiTextArea } from "@/shared/atoms/ui-primitives";

type Draft = Pick<PlanningPromptTemplateEdit, "expectedVersion" | "text">;
type PublishResult = { published: PlanningPromptTemplate } | { error?: string; conflict: boolean };
const templateLabels = {
  general: "Allgemeine Prompt-Vorlage",
  initiative: "Prompt-Vorlage für Initiativen",
  deliverable: "Prompt-Vorlage für Deliverables",
  sub_issue: "Prompt-Vorlage für Sub-Issues",
} satisfies Record<PlanningPromptTemplate["kind"], string>;

function readStoredDraft(key: string): Draft | null {
  try {
    const stored = JSON.parse(window.localStorage.getItem(key) ?? "null");
    if (typeof stored?.text === "string" && Number.isInteger(stored.expectedVersion) && stored.expectedVersion > 0) {
      return { text: stored.text, expectedVersion: stored.expectedVersion };
    }
  } catch {
    return null;
  }
  return null;
}

export function PlanningPromptTemplateEditor({ profileId, template, onReload, onPublish }: {
  profileId: string;
  template: PlanningPromptTemplate;
  onReload: () => void;
  onPublish: (edit: PlanningPromptTemplateEdit) => Promise<PublishResult>;
}) {
  const editorId = useId();
  const titleId = `${editorId}-title`;
  const key = `founderops:planning-prompt-draft:${profileId}:${template.kind}`;
  const [draft, setDraft] = useState(() => readStoredDraft(key));
  const [busy, setBusy] = useState(false);
  const [published, setPublished] = useState(false);
  const [failure, setFailure] = useState("");
  const [needsReload, setNeedsReload] = useState(false);
  const [storageFailed, setStorageFailed] = useState(false);
  const hasNewVersion = Boolean(draft && draft.expectedVersion !== template.version);

  function updateDraft(next: Draft) {
    setDraft(next);
    setPublished(false);
    try {
      window.localStorage.setItem(key, JSON.stringify(next));
      setStorageFailed(false);
    } catch {
      setStorageFailed(true);
    }
  }

  async function publish() {
    if (!draft || busy || !draft.text.trim() || hasNewVersion || needsReload) return;
    setBusy(true);
    setFailure("");
    try {
      const result = await onPublish({ kind: template.kind, ...draft });
      if (!("published" in result)) {
        setNeedsReload(result.conflict);
        setFailure(result.error || "Prompt-Vorlage konnte nicht veröffentlicht werden.");
        return;
      }
      const stored = readStoredDraft(key);
      if (stored?.text === draft.text && stored.expectedVersion === draft.expectedVersion) {
        try {
          window.localStorage.removeItem(key);
          setStorageFailed(false);
        } catch {
          setStorageFailed(true);
        }
      }
      setDraft(null);
      setPublished(true);
    } catch {
      setFailure("Die Veröffentlichung konnte nicht bestätigt werden. Dein Entwurf bleibt erhalten.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <UiPanel aria-labelledby={titleId} className="grid min-w-0 gap-4">
      <div>
        <h2 id={titleId} className="text-lg font-semibold text-slate-950">
          <label htmlFor={editorId}>{templateLabels[template.kind]}</label>
        </h2>
        <p className="mt-1 text-sm text-slate-600">Aktive Fassung {template.version}</p>
      </div>
      {hasNewVersion && (
        <UiNotice tone="warning">
          <p>Die aktive Fassung wurde seit Beginn dieses Entwurfs geändert.</p>
          <details className="mt-2">
            <summary className="min-h-11 cursor-pointer py-2">Aktive Fassung anzeigen</summary>
            <p className="whitespace-pre-wrap break-words">{template.text}</p>
          </details>
          <UiButton className="mt-2 min-h-11" onClick={() => {
            if (draft) updateDraft({ text: draft.text, expectedVersion: template.version });
            setFailure("");
            setNeedsReload(false);
          }}>Entwurf für diese Fassung übernehmen</UiButton>
        </UiNotice>
      )}
      <form className="grid gap-3" onSubmit={event => { event.preventDefault(); void publish(); }}>
        <UiTextArea
          id={editorId}
          className="w-full"
          rows={11}
          inputPadding="md"
          leading="relaxed"
          value={draft?.text ?? template.text}
          onChange={event => updateDraft({ text: event.target.value, expectedVersion: draft?.expectedVersion ?? template.version })}
          readOnly={busy}
        />
        {storageFailed && <UiNotice tone="warning" role="alert">Der lokale Entwurf konnte im Browser nicht aktualisiert werden.</UiNotice>}
        {failure && <UiNotice tone="warning" role="alert">{failure}</UiNotice>}
        <div className="flex flex-wrap items-center gap-3">
          <UiButton type="submit" variant="primary" className="min-h-11"
            disabled={busy || !draft?.text.trim() || hasNewVersion || needsReload}
          >{busy ? "Wird veröffentlicht …" : "Veröffentlichen"}</UiButton>
          {needsReload && !hasNewVersion && <UiButton className="min-h-11" onClick={onReload}>Aktive Fassung neu laden</UiButton>}
          <p className="text-sm text-slate-600" role="status">
            {published ? "Prompt-Vorlage veröffentlicht." : draft && !storageFailed ? "Entwurf auf diesem Gerät gespeichert." : ""}
          </p>
        </div>
      </form>
    </UiPanel>
  );
}
