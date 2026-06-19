"use client";

import { useDecisionLogWorkflow } from "@/features/decisions/hooks/use-decision-log-workflow";
import { DecisionCreateForm } from "@/features/decisions/molecules/decision-create-form";
import { DecisionLogSummary } from "@/features/decisions/molecules/decision-log-summary";
import { DecisionCard } from "@/features/decisions/organisms/decision-card";
import { decisionAuditEntries, decisionLinkedTasks, type DecisionPayload } from "@/features/decisions/model/decision-log-view-model";
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
  const {
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
  } = useDecisionLogWorkflow({ data, currentProfileId, onCreate, onEdit, onObject });

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
            onEditSubmit={() => submitEdit(decision.id)}
            onObjectSubmit={() => submitObjection(decision.id)}
            onObjectionChange={(nextObjectionText) => setObjectionDraft(decision.id, nextObjectionText)}
            onRemoveDecisionTaskLink={onRemoveDecisionTaskLink}
            onToggleAudit={() => toggleAudit(decision.id)}
            onToggleEdit={() => toggleEdit(decision)}
            onToggleOpen={() => toggleOpen(decision.id)}
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
