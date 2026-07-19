"use client";

import { useMemo, useState } from "react";
import type { FounderSprintScore, Profile, ScoreObjection, ScoreObjectionResolutionInput } from "@/lib/types";
import { CustomSelect } from "@/shared/atoms/custom-select";
import { UiButton, UiTextArea, UiTextInput } from "@/shared/atoms/ui-primitives";

export function ScoreObjectionReviewControls({
  objection,
  currentProfile,
  profiles,
  currentScore,
  pending,
  onSubmit,
}: {
  objection: ScoreObjection;
  currentProfile: Profile | null;
  profiles: Profile[];
  currentScore: Pick<FounderSprintScore, "deliveryPoints" | "formPoints" | "weeklyPoints">;
  pending: boolean;
  onSubmit: (input: ScoreObjectionResolutionInput) => void;
}) {
  const [resolutionComment, setResolutionComment] = useState("");
  const [deliveryPoints, setDeliveryPoints] = useState(currentScore.deliveryPoints);
  const [formPoints, setFormPoints] = useState(currentScore.formPoints);
  const [weeklyPoints, setWeeklyPoints] = useState(currentScore.weeklyPoints);
  const [secondReviewerProfileId, setSecondReviewerProfileId] = useState(objection.secondReviewerProfileId || "");
  const [secondReviewDecision, setSecondReviewDecision] = useState("");

  const secondReviewerOptions = useMemo(() => profiles
    .filter((profile) => profile.platformRole !== "viewer" && profile.id !== currentProfile?.id && profile.id !== objection.profileId)
    .map((profile) => ({ value: profile.id, label: profile.name })), [currentProfile?.id, objection.profileId, profiles]);

  if (!currentProfile || objection.status !== "open") return null;

  const isCeo = currentProfile.platformRole === "ceo";
  const secondReviewPending = Boolean(objection.secondReviewerProfileId && !objection.secondReviewedAt);
  const isAssignedSecondReviewer = secondReviewPending && objection.secondReviewerProfileId === currentProfile.id;
  const independentReviewRequired = objection.profileId === currentProfile.id;
  const canResolve = isCeo && !secondReviewPending && (!independentReviewRequired || Boolean(objection.secondReviewedAt));

  const submitResolution = (status: "reviewed" | "dismissed" | "accepted") => {
    onSubmit({
      action: "resolve",
      status,
      resolutionComment,
      ...(status === "accepted" ? { deliveryPoints, formPoints, weeklyPoints } : {}),
    });
  };

  return (
    <div className="grid gap-3 border-t border-slate-200 pt-3">
      {isCeo && !objection.secondReviewedAt ? (
        <div className="grid gap-2 rounded-md border border-slate-200 bg-white p-3">
          <label className="grid gap-1 text-xs font-semibold text-slate-700">
            Zweitreview zuweisen
            <CustomSelect
              value={secondReviewerProfileId}
              onChange={setSecondReviewerProfileId}
              disabled={pending || Boolean(objection.secondReviewedAt)}
              options={[{ value: "", label: "Person auswählen" }, ...secondReviewerOptions]}
              aria-label="Person für Zweitreview auswählen"
            />
          </label>
          <div>
            <UiButton
              disabled={pending || !secondReviewerProfileId || secondReviewerProfileId === objection.secondReviewerProfileId}
              onClick={() => onSubmit({ action: "assign_second_review", secondReviewerProfileId })}
              size="sm"
              variant="blue"
            >
              {objection.secondReviewerProfileId ? "Zuweisung ändern" : "Zweitreview zuweisen"}
            </UiButton>
          </div>
          {secondReviewPending ? (
            <p className="text-xs text-slate-500">Der Einwand bleibt offen, bis der zugewiesene Zweitreview vorliegt.</p>
          ) : independentReviewRequired ? (
            <p className="text-xs text-slate-500">Ein eigener Einwand des CEO benötigt vor der Entscheidung einen unabhängigen Zweitreview.</p>
          ) : null}
        </div>
      ) : null}

      {isAssignedSecondReviewer ? (
        <div className="grid gap-2">
          <UiTextArea
            value={secondReviewDecision}
            onChange={(event) => setSecondReviewDecision(event.target.value)}
            minHeight="sm"
            placeholder="Unabhängige Einschätzung dokumentieren"
            aria-label="Zweitreview-Entscheidung"
          />
          <div>
            <UiButton
              disabled={pending || !secondReviewDecision.trim()}
              onClick={() => onSubmit({ action: "second_review", secondReviewDecision })}
              variant="blue"
              size="sm"
            >
              Zweitreview einreichen
            </UiButton>
          </div>
        </div>
      ) : null}

      {canResolve ? (
        <div className="grid gap-2">
          <UiTextArea
            value={resolutionComment}
            onChange={(event) => setResolutionComment(event.target.value)}
            minHeight="sm"
            placeholder="Finale Entscheidung sachlich begründen"
            aria-label="Begründung zur Einwand-Entscheidung"
          />
          <div className="grid gap-2 sm:grid-cols-3">
            <label className="grid gap-1 text-xs font-medium text-slate-600">
              Delivery (0–12)
              <UiTextInput type="number" min={0} max={12} value={deliveryPoints} onChange={(event) => setDeliveryPoints(Number(event.target.value))} aria-label="Korrigierte Delivery-Punkte" />
            </label>
            <label className="grid gap-1 text-xs font-medium text-slate-600">
              Form / Review-Reife (0–4)
              <UiTextInput type="number" min={0} max={4} value={formPoints} onChange={(event) => setFormPoints(Number(event.target.value))} aria-label="Korrigierte Form-Punkte" />
            </label>
            <label className="grid gap-1 text-xs font-medium text-slate-600">
              Weekly (0–4)
              <UiTextInput type="number" min={0} max={4} value={weeklyPoints} onChange={(event) => setWeeklyPoints(Number(event.target.value))} aria-label="Korrigierte Weekly-Punkte" />
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <UiButton disabled={pending || !resolutionComment.trim()} onClick={() => submitResolution("reviewed")} variant="blue" size="sm">Geprüft</UiButton>
            <UiButton disabled={pending || !resolutionComment.trim()} onClick={() => submitResolution("dismissed")} variant="amber" size="sm">Ablehnen</UiButton>
            <UiButton disabled={pending || !resolutionComment.trim()} onClick={() => submitResolution("accepted")} variant="emerald" size="sm">Annehmen & Score aktualisieren</UiButton>
          </div>
        </div>
      ) : null}

      {!isCeo && !isAssignedSecondReviewer ? (
        <p className="text-xs text-slate-500">Der Einwand wartet auf die Entscheidung des CEO.</p>
      ) : null}
    </div>
  );
}
