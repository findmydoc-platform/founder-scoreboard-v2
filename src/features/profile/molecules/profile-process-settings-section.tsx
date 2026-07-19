"use client";

import { useState } from "react";
import { SettingsPane, SettingsRow } from "@/features/profile/molecules/profile-settings-layout";
import { MAX_REVIEW_OBJECTION_WINDOW_HOURS } from "@/lib/sprint-review-window";
import { UiButton, UiNotice, UiTextInput } from "@/shared/atoms/ui-primitives";

function durationLabel(hours: number) {
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  if (!days) return `${hours} ${hours === 1 ? "Stunde" : "Stunden"}`;
  if (!remainingHours) return `${hours} Stunden · ${days} ${days === 1 ? "Tag" : "Tage"}`;
  return `${hours} Stunden · ${days} ${days === 1 ? "Tag" : "Tage"} und ${remainingHours} Stunden`;
}

export function ProfileProcessSettingsSection({
  reviewObjectionWindowHours,
  pending,
  onSave,
}: {
  reviewObjectionWindowHours: number;
  pending: boolean;
  onSave: (hours: number) => Promise<void>;
}) {
  const [draftValue, setDraftValue] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const value = draftValue ?? String(reviewObjectionWindowHours);
  const parsedValue = Number(value);
  const valid = Number.isInteger(parsedValue) && parsedValue >= 1 && parsedValue <= MAX_REVIEW_OBJECTION_WINDOW_HOURS;
  const changed = valid
    ? parsedValue !== reviewObjectionWindowHours
    : value.trim() !== String(reviewObjectionWindowHours);
  const helpId = "founderops-review-window-help";
  const messageId = "founderops-review-window-message";

  const save = async () => {
    if (!valid) {
      setMessage({
        tone: "danger",
        text: `Bitte eine ganze Zahl zwischen 1 und ${MAX_REVIEW_OBJECTION_WINDOW_HOURS} Stunden eingeben.`,
      });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      await onSave(parsedValue);
      setDraftValue(null);
      setMessage({ tone: "success", text: "Frist gespeichert. Alle ungelockten Sprints wurden aktualisiert." });
    } catch (error) {
      setMessage({
        tone: "danger",
        text: error instanceof Error ? error.message : "Frist konnte nicht gespeichert werden.",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsPane
      eyebrow="CEO · Global"
      title="Review-Prozess"
      description="Diese Einstellung gilt teamweit für den FounderOps-Prozess und nicht nur für dein Profil."
    >
      <SettingsRow
        label="Review- und Einspruchsfrist"
        description="Exakte Zeit ab Ende des Sprinttages, in der Reviews abgeschlossen und Score-Einwände eingereicht werden können."
        align="start"
      >
        <div className="grid min-w-0 gap-2 md:w-80 md:text-left">
          <label className="text-xs font-semibold text-slate-600" htmlFor="founderops-review-window-hours">
            Dauer in Stunden
          </label>
          <div className="flex items-center gap-2">
            <UiTextInput
              id="founderops-review-window-hours"
              type="number"
              min={1}
              max={MAX_REVIEW_OBJECTION_WINDOW_HOURS}
              step={1}
              value={value}
              disabled={pending || saving}
              aria-describedby={message ? `${helpId} ${messageId}` : helpId}
              aria-invalid={message?.tone === "danger" || undefined}
              aria-errormessage={message?.tone === "danger" ? messageId : undefined}
              className="w-28 tabular-nums"
              onChange={(event) => {
                setDraftValue(event.target.value);
                setMessage(null);
              }}
              onBlur={() => {
                if (!valid) return;
                setDraftValue(parsedValue === reviewObjectionWindowHours ? null : String(parsedValue));
              }}
            />
            <span className="text-sm text-slate-500">Stunden</span>
          </div>
          <p id={helpId} className="text-xs leading-5 text-slate-500">
            {valid ? durationLabel(parsedValue) : `Zulässig: 1–${MAX_REVIEW_OBJECTION_WINDOW_HOURS} Stunden`}
          </p>
          <UiNotice tone="info" size="compact">
            Eine Änderung berechnet die Frist aller noch nicht gelockten Sprints neu. Eine Kürzung kann laufende Fristen sofort schließen. Gelockte Sprints bleiben unverändert.
          </UiNotice>
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
            <UiButton variant="primary" disabled={pending || saving || !changed} onClick={save}>
              {saving ? "Wird gespeichert …" : "Frist speichern"}
            </UiButton>
          </div>
        </div>
      </SettingsRow>
    </SettingsPane>
  );
}
