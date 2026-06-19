"use client";

import { useState } from "react";
import type { DecisionEditDraft, DecisionPayload } from "@/features/decisions/model/decision-log-view-model";
import type { PlanningData } from "@/lib/types";

export function useDecisionLogWorkflow({
  data,
  currentProfileId,
  onCreate,
  onEdit,
  onObject,
}: {
  data: PlanningData;
  currentProfileId: string;
  onCreate: (payload: DecisionPayload) => void;
  onEdit: (decisionId: number, payload: DecisionPayload) => void;
  onObject: (decisionId: number, comment: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [context, setContext] = useState("");
  const [decisionText, setDecisionText] = useState("");
  const [requiredProfileIds, setRequiredProfileIds] = useState<string[]>(() => data.profiles.map((profile) => profile.id));
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<DecisionEditDraft>({ title: "", context: "", decision: "", requiredProfileIds: [] });
  const [objectionDrafts, setObjectionDrafts] = useState<Record<number, string>>({});
  const [openDecisions, setOpenDecisions] = useState<Record<number, boolean>>({});
  const [openAudits, setOpenAudits] = useState<Record<number, boolean>>({});
  const currentProfile = data.profiles.find((profile) => profile.id === currentProfileId);
  const canCreate = currentProfile?.platformRole === "ceo";

  const resetForm = () => {
    setTitle("");
    setContext("");
    setDecisionText("");
    setRequiredProfileIds(data.profiles.map((profile) => profile.id));
  };

  const startEdit = (item: PlanningData["decisions"][number]) => {
    setEditingId(item.id);
    setEditDraft({
      title: item.title,
      context: item.context,
      decision: item.decision,
      requiredProfileIds: item.requiredProfileIds,
    });
  };

  const submitCreate = () => {
    onCreate({ title, context, decision: decisionText, requiredProfileIds });
    resetForm();
  };

  const submitEdit = (decisionId: number) => {
    onEdit(decisionId, editDraft);
    setEditingId(null);
  };

  const submitObjection = (decisionId: number) => {
    onObject(decisionId, objectionDrafts[decisionId] || "");
    setObjectionDrafts((current) => ({ ...current, [decisionId]: "" }));
  };

  const setObjectionDraft = (decisionId: number, nextObjectionText: string) => {
    setObjectionDrafts((current) => ({ ...current, [decisionId]: nextObjectionText }));
  };

  const toggleAudit = (decisionId: number) => {
    setOpenAudits((current) => ({ ...current, [decisionId]: !(current[decisionId] ?? false) }));
  };

  const toggleOpen = (decisionId: number) => {
    setOpenDecisions((current) => ({ ...current, [decisionId]: !(current[decisionId] ?? false) }));
  };

  const toggleEdit = (decision: PlanningData["decisions"][number]) => {
    setOpenDecisions((current) => ({ ...current, [decision.id]: true }));
    if (editingId === decision.id) setEditingId(null);
    else startEdit(decision);
  };

  return {
    canCreate,
    context,
    decisionText,
    editDraft,
    editingId,
    objectionDrafts,
    openAudits,
    openDecisions,
    requiredProfileIds,
    setContext,
    setDecisionText,
    setEditDraft,
    setObjectionDraft,
    setRequiredProfileIds,
    setTitle,
    submitCreate,
    submitEdit,
    submitObjection,
    title,
    toggleAudit,
    toggleEdit,
    toggleOpen,
  };
}
