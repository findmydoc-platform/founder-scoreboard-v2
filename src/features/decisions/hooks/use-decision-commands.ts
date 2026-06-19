"use client";

import type { PlanningCommandContext } from "@/features/planning/hooks/planning-command-context";
import * as planningApi from "@/features/planning/model/planning-api-client";

type DecisionPayload = {
  title: string;
  context: string;
  decision: string;
  requiredProfileIds: string[];
};

export function useDecisionCommands({
  apiClient,
  currentProfile,
  setData,
  setSaveError,
  startTransition,
}: PlanningCommandContext) {
  const createDecision = (payload: DecisionPayload) => {
    setSaveError("");

    startTransition(async () => {
      try {
        const { response, body } = await planningApi.createDecisionRequest(apiClient, payload);
        if (!response.ok || !body?.decision) {
          throw new Error(body?.error || "Decision konnte nicht erstellt werden.");
        }

        setData((current) => ({
          ...current,
          decisions: [body.decision!, ...current.decisions],
          audit: [
            {
              id: Date.now(),
              entityType: "decision",
              entityId: String(body.decision!.id),
              action: "create",
              actorProfileId: currentProfile?.id || "",
              createdAt: new Date().toISOString(),
            },
            ...current.audit,
          ],
        }));
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : "Decision konnte nicht erstellt werden.");
      }
    });
  };

  const confirmDecision = (decisionId: number) => {
    if (!currentProfile) {
      setSaveError("GitHub-User ist keinem Teamprofil zugeordnet.");
      return;
    }

    setSaveError("");

    startTransition(async () => {
      try {
        const { response, body } = await planningApi.confirmDecisionRequest(apiClient, decisionId);
        if (!response.ok) throw new Error(body?.error || "Bestätigung konnte nicht gespeichert werden.");

        setData((current) => ({
          ...current,
          decisions: current.decisions.map((decision) => {
            if (decision.id !== decisionId) return decision;
            const confirmedProfileIds = body?.confirmedProfileIds || [...new Set([...decision.confirmedProfileIds, currentProfile.id])];
            return {
              ...decision,
              confirmedProfileIds,
              status: body?.locked ? "locked" : decision.status,
              lockedAt: body?.locked ? new Date().toISOString() : decision.lockedAt,
            };
          }),
          audit: [
            {
              id: Date.now(),
              entityType: "decision",
              entityId: String(decisionId),
              action: body?.locked ? "confirm_and_lock" : "confirm",
              actorProfileId: currentProfile.id,
              createdAt: new Date().toISOString(),
            },
            ...current.audit,
          ],
        }));
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : "Bestätigung konnte nicht gespeichert werden.");
      }
    });
  };

  const editDecision = (decisionId: number, payload: DecisionPayload) => {
    setSaveError("");

    startTransition(async () => {
      try {
        const { response, body } = await planningApi.updateDecisionRequest(apiClient, decisionId, payload);
        if (!response.ok || !body?.decision) throw new Error(body?.error || "Decision konnte nicht aktualisiert werden.");

        setData((current) => ({
          ...current,
          decisions: current.decisions.map((decision) => (decision.id === decisionId ? body.decision! : decision)),
          audit: [
            {
              id: Date.now(),
              entityType: "decision",
              entityId: String(decisionId),
              action: "decision.update",
              actorProfileId: currentProfile?.id || "",
              createdAt: new Date().toISOString(),
              beforeData: current.decisions.find((decision) => decision.id === decisionId) || null,
              afterData: body.decision,
            },
            ...current.audit,
          ],
        }));
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : "Decision konnte nicht aktualisiert werden.");
      }
    });
  };

  const objectDecision = (decisionId: number, comment: string) => {
    if (!currentProfile) {
      setSaveError("GitHub-User ist keinem Teamprofil zugeordnet.");
      return;
    }

    setSaveError("");

    startTransition(async () => {
      try {
        const { response, body } = await planningApi.objectDecisionRequest(apiClient, decisionId, comment);
        if (!response.ok || !body?.comment) throw new Error(body?.error || "Einwand konnte nicht gespeichert werden.");

        setData((current) => ({
          ...current,
          decisionComments: [body.comment!, ...current.decisionComments],
          audit: [
            {
              id: Date.now(),
              entityType: "decision",
              entityId: String(decisionId),
              action: "decision.objection",
              actorProfileId: currentProfile.id,
              createdAt: new Date().toISOString(),
            },
            ...current.audit,
          ],
        }));
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : "Einwand konnte nicht gespeichert werden.");
      }
    });
  };

  return {
    confirmDecision,
    createDecision,
    editDecision,
    objectDecision,
  };
}
