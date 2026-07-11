"use client";

import { useState } from "react";
import type { FounderSprintScore, Profile, ScoreObjection, ScoreObjectionResolutionInput } from "@/lib/types";
import { UiButton, UiTextArea, UiTextInput } from "@/shared/atoms/ui-primitives";

export function ScoreObjectionReviewControls({
  objection,
  currentProfile,
  currentScore,
  pending,
  onSubmit,
}: {
  objection: ScoreObjection;
  currentProfile: Profile | null;
  currentScore: Pick<FounderSprintScore, "deliveryPoints" | "formPoints" | "weeklyPoints">;
  pending: boolean;
  onSubmit: (input: ScoreObjectionResolutionInput) => void;
}) {
  const [resolutionComment, setResolutionComment] = useState("");
  const [deliveryPoints, setDeliveryPoints] = useState(currentScore.deliveryPoints);
  const [formPoints, setFormPoints] = useState(currentScore.formPoints);
  const [weeklyPoints, setWeeklyPoints] = useState(currentScore.weeklyPoints);
  const [secondReviewDecision, setSecondReviewDecision] = useState("");

  if (objection.status === "open") {
    const submitResolution = (status: "reviewed" | "dismissed" | "accepted") => {
      onSubmit({
        action: "resolve",
        status,
        resolutionComment,
        ...(status === "accepted" ? { deliveryPoints, formPoints, weeklyPoints } : {}),
      });
    };

    return (
      <div className="grid gap-2 border-t border-slate-200 pt-3">
        <UiTextArea
          value={resolutionComment}
          onChange={(event) => setResolutionComment(event.target.value)}
          minHeight="sm"
          placeholder="Entscheidung sachlich begründen"
          aria-label="Begründung zur Einwand-Entscheidung"
        />
        <div className="grid gap-2 sm:grid-cols-3">
          <label className="grid gap-1 text-xs font-medium text-slate-600">
            Delivery (0–12)
            <UiTextInput
              type="number"
              min={0}
              max={12}
              value={deliveryPoints}
              onChange={(event) => setDeliveryPoints(Number(event.target.value))}
              aria-label="Korrigierte Delivery-Punkte"
            />
          </label>
          <label className="grid gap-1 text-xs font-medium text-slate-600">
            Form / Review-Reife (0–4)
            <UiTextInput
              type="number"
              min={0}
              max={4}
              value={formPoints}
              onChange={(event) => setFormPoints(Number(event.target.value))}
              aria-label="Korrigierte Form-Punkte"
            />
          </label>
          <label className="grid gap-1 text-xs font-medium text-slate-600">
            Weekly (0–4)
            <UiTextInput
              type="number"
              min={0}
              max={4}
              value={weeklyPoints}
              onChange={(event) => setWeeklyPoints(Number(event.target.value))}
              aria-label="Korrigierte Weekly-Punkte"
            />
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          <UiButton disabled={pending || !resolutionComment.trim()} onClick={() => submitResolution("reviewed")} variant="blue" size="sm">
            Geprüft
          </UiButton>
          <UiButton disabled={pending || !resolutionComment.trim()} onClick={() => submitResolution("dismissed")} variant="amber" size="sm">
            Ablehnen
          </UiButton>
          <UiButton disabled={pending || !resolutionComment.trim()} onClick={() => submitResolution("accepted")} variant="emerald" size="sm">
            Annehmen & Score aktualisieren
          </UiButton>
        </div>
      </div>
    );
  }

  if (objection.secondReviewedAt) return null;

  if (!currentProfile || objection.reviewedBy === currentProfile.id) {
    return (
      <p className="border-t border-slate-200 pt-2 text-xs text-slate-500">
        Ein einmaliger Zweitreview muss durch einen anderen CEO oder Deputy erfolgen.
      </p>
    );
  }

  return (
    <div className="grid gap-2 border-t border-slate-200 pt-3">
      <UiTextArea
        value={secondReviewDecision}
        onChange={(event) => setSecondReviewDecision(event.target.value)}
        minHeight="sm"
        placeholder="Unabhängige Zweitreview-Entscheidung dokumentieren"
        aria-label="Zweitreview-Entscheidung"
      />
      <div>
        <UiButton
          disabled={pending || !secondReviewDecision.trim()}
          onClick={() => onSubmit({ action: "second_review", secondReviewDecision })}
          variant="blue"
          size="sm"
        >
          Zweitreview speichern
        </UiButton>
      </div>
    </div>
  );
}

