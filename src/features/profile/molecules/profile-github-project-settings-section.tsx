"use client";

import { ExternalLink } from "lucide-react";
import { useState } from "react";
import { SettingsPane, SettingsRow } from "@/features/profile/molecules/profile-settings-layout";
import { githubProjectUrl, validGitHubProjectNumber, validGitHubProjectOwner } from "@/lib/github-project-config";
import { UiButton, UiNotice, UiTextInput } from "@/shared/atoms/ui-primitives";

export function ProfileGitHubProjectSettingsSection({
  githubProjectOwner,
  githubProjectNumber,
  pending,
  onSave,
}: {
  githubProjectOwner: string;
  githubProjectNumber: number;
  pending: boolean;
  onSave: (owner: string, number: number) => Promise<void>;
}) {
  const [ownerDraft, setOwnerDraft] = useState<string | null>(null);
  const [numberDraft, setNumberDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const owner = ownerDraft ?? githubProjectOwner;
  const numberValue = numberDraft ?? String(githubProjectNumber);
  const number = Number(numberValue);
  const valid = validGitHubProjectOwner(owner) && validGitHubProjectNumber(number);
  const projectLink = valid ? githubProjectUrl(owner, number) : "";
  const messageId = "founderops-github-project-message";

  const save = async () => {
    if (!valid) {
      setMessage({ tone: "danger", text: "Bitte eine gültige GitHub-Organisation und positive Project-Nummer eingeben." });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      await onSave(owner, number);
      setOwnerDraft(null);
      setNumberDraft(null);
      setMessage({ tone: "success", text: "Project, Repository-Verknüpfungen und Felder wurden geprüft und gespeichert." });
    } catch (error) {
      setMessage({
        tone: "danger",
        text: error instanceof Error ? error.message : "GitHub Project konnte nicht geprüft und gespeichert werden.",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsPane
      eyebrow="CEO & aktive Deputies · Global"
      title="GitHub Project"
      description="Ziel für repositoryübergreifend synchronisierte GitHub Issues. FounderOps bleibt führend."
    >
      <SettingsRow
        label="Project-Ziel"
        description="Vor dem Speichern prüft FounderOps den App-Zugriff, alle drei Repository-Verknüpfungen und die erwarteten Felder."
        align="start"
      >
        <div className="grid min-w-0 gap-3 md:w-96 md:text-left" data-tour-id="founderops-github-project-settings">
          <label className="grid gap-1 text-xs font-semibold text-slate-600" htmlFor="founderops-github-project-owner">
            GitHub-Organisation
            <UiTextInput
              id="founderops-github-project-owner"
              value={owner}
              disabled={pending || saving}
              autoComplete="off"
              aria-describedby={message ? messageId : undefined}
              aria-invalid={message?.tone === "danger" || undefined}
              onChange={(event) => {
                setOwnerDraft(event.target.value);
                setMessage(null);
              }}
            />
          </label>
          <label className="grid gap-1 text-xs font-semibold text-slate-600" htmlFor="founderops-github-project-number">
            Project-Nummer
            <UiTextInput
              id="founderops-github-project-number"
              type="number"
              min={1}
              step={1}
              value={numberValue}
              disabled={pending || saving}
              className="w-32 tabular-nums"
              aria-describedby={message ? messageId : undefined}
              aria-invalid={message?.tone === "danger" || undefined}
              onChange={(event) => {
                setNumberDraft(event.target.value);
                setMessage(null);
              }}
            />
          </label>
          {projectLink ? (
            <a
              href={projectLink}
              target="_blank"
              rel="noreferrer"
              className="inline-flex w-fit items-center gap-1 text-sm font-semibold text-blue-700 hover:text-blue-900"
            >
              Aktuell konfiguriertes Project öffnen
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
            </a>
          ) : null}
          {message ? (
            <UiNotice
              id={messageId}
              tone={message.tone}
              size="compact"
              role={message.tone === "danger" ? "alert" : "status"}
              aria-live={message.tone === "danger" ? "assertive" : "polite"}
            >
              {message.text}
            </UiNotice>
          ) : null}
          <div>
            <UiButton variant="primary" disabled={pending || saving || !valid} onClick={save}>
              {saving ? "Wird geprüft …" : "Prüfen und speichern"}
            </UiButton>
          </div>
        </div>
      </SettingsRow>
    </SettingsPane>
  );
}
