"use client";

import { useState } from "react";
import { DecisionCreateForm } from "@/features/decisions/molecules/decision-create-form";
import { DecisionLogSummary } from "@/features/decisions/molecules/decision-log-summary";
import { DecisionCard } from "@/features/decisions/organisms/decision-card";
import { decisionAuditEntries, decisionLinkedTasks, type DecisionEditDraft, type DecisionPayload } from "@/features/decisions/model/decision-log-view-model";
import type { DecisionTaskLink, PlanningData } from "@/lib/types";

export function DecisionLogOverview({
  data,
  currentProfileId,
  pending,
  onCreate,
  onConfirm,
  onEdit,
  onObject,
  onRemoveDecisionTaskLink,
  onCreateFollowUp,
}: {
  data: PlanningData;
  currentProfileId: string;
  pending: boolean;
  onCreate: (payload: DecisionPayload) => void;
  onConfirm: (decisionId: number) => void;
  onEdit: (decisionId: number, payload: DecisionPayload) => void;
  onObject: (decisionId: number, comment: string) => void;
  onRemoveDecisionTaskLink: (link: DecisionTaskLink) => void;
  onCreateFollowUp: (decision: PlanningData["decisions"][number]) => void;
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

  return (
    <div className="grid gap-4">
      <DecisionLogSummary decisionCount={data.decisions.length} />
      <DecisionCreateForm
        canCreate={canCreate}
        context={context}
        decisionText={decisionText}
        pending={pending}
        profiles={data.profiles}
        requiredProfileIds={requiredProfileIds}
        title={title}
        onContextChange={setContext}
        onDecisionTextChange={setDecisionText}
        onRequiredProfileIdsChange={setRequiredProfileIds}
        onSubmit={submitCreate}
        onTitleChange={setTitle}
      />
      {data.decisions.length ? data.decisions.map((decision) => {
        const isEditing = editingId === decision.id;
        const isOpen = openDecisions[decision.id] ?? false;
        const auditOpen = openAudits[decision.id] ?? false;
        const comments = data.decisionComments.filter((comment) => comment.decisionId === decision.id);
        const auditEntries = decisionAuditEntries(data, decision.id);
        const objectionText = objectionDrafts[decision.id] || "";
        const linkedTasks = decisionLinkedTasks(data, decision.id);

        return (
          <DecisionCard
            key={decision.id}
            auditEntries={auditEntries}
            auditOpen={auditOpen}
            canCreate={canCreate}
            comments={comments}
            currentProfileId={currentProfileId}
            decision={decision}
            editDraft={editDraft}
            isEditing={isEditing}
            isOpen={isOpen}
            linkedTasks={linkedTasks}
            objectionText={objectionText}
            pending={pending}
            profiles={data.profiles}
            onConfirm={() => onConfirm(decision.id)}
            onCreateFollowUp={() => onCreateFollowUp(decision)}
            onEditDraftChange={setEditDraft}
            onEditSubmit={() => {
              onEdit(decision.id, editDraft);
              setEditingId(null);
            }}
            onObjectSubmit={() => {
              onObject(decision.id, objectionText);
              setObjectionDrafts((current) => ({ ...current, [decision.id]: "" }));
            }}
            onObjectionChange={(nextObjectionText) => setObjectionDrafts((current) => ({ ...current, [decision.id]: nextObjectionText }))}
            onRemoveDecisionTaskLink={onRemoveDecisionTaskLink}
            onToggleAudit={() => setOpenAudits((current) => ({ ...current, [decision.id]: !auditOpen }))}
            onToggleEdit={() => {
              setOpenDecisions((current) => ({ ...current, [decision.id]: true }));
              if (isEditing) setEditingId(null);
              else startEdit(decision);
            }}
            onToggleOpen={() => setOpenDecisions((current) => ({ ...current, [decision.id]: !isOpen }))}
          />
        );
      }) : (
        <section className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
          Noch keine Decisions. Der erste Eintrag wird vom CEO erstellt und danach zur Bestätigung geöffnet.
        </section>
      )}
    </div>
  );
}
