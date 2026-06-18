import { ChevronRight } from "lucide-react";
import { DecisionAuditTrail } from "@/features/decisions/molecules/decision-audit-trail";
import { DecisionCommentsList } from "@/features/decisions/molecules/decision-comments-list";
import { DecisionConfirmationStrip } from "@/features/decisions/molecules/decision-confirmation-strip";
import { DecisionEditForm } from "@/features/decisions/molecules/decision-edit-form";
import { DecisionFollowUpList } from "@/features/decisions/molecules/decision-follow-up-list";
import { DecisionObjectionForm } from "@/features/decisions/molecules/decision-objection-form";
import { decisionStatusLabel, type DecisionAuditEntry, type DecisionComment, type DecisionEditDraft, type DecisionItem, type DecisionLinkedTask } from "@/features/decisions/model/decision-log-view-model";
import type { DecisionTaskLink, Profile } from "@/lib/types";

type DecisionCardProps = {
  auditEntries: DecisionAuditEntry[];
  auditOpen: boolean;
  canCreate: boolean;
  comments: DecisionComment[];
  currentProfileId: string;
  decision: DecisionItem;
  editDraft: DecisionEditDraft;
  isEditing: boolean;
  isOpen: boolean;
  linkedTasks: DecisionLinkedTask[];
  objectionText: string;
  pending: boolean;
  profiles: Profile[];
  onConfirm: () => void;
  onCreateFollowUp: () => void;
  onEditDraftChange: (draft: DecisionEditDraft) => void;
  onEditSubmit: () => void;
  onObjectSubmit: () => void;
  onObjectionChange: (objectionText: string) => void;
  onRemoveDecisionTaskLink: (link: DecisionTaskLink) => void;
  onToggleAudit: () => void;
  onToggleEdit: () => void;
  onToggleOpen: () => void;
};

export function DecisionCard({
  auditEntries,
  auditOpen,
  canCreate,
  comments,
  currentProfileId,
  decision,
  editDraft,
  isEditing,
  isOpen,
  linkedTasks,
  objectionText,
  pending,
  profiles,
  onConfirm,
  onCreateFollowUp,
  onEditDraftChange,
  onEditSubmit,
  onObjectSubmit,
  onObjectionChange,
  onRemoveDecisionTaskLink,
  onToggleAudit,
  onToggleEdit,
  onToggleOpen,
}: DecisionCardProps) {
  return (
    <article className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <button type="button" onClick={onToggleOpen} className="flex min-w-0 flex-1 items-start gap-2 text-left" aria-expanded={isOpen}>
          <ChevronRight size={16} className={`mt-0.5 shrink-0 text-slate-400 transition-transform ${isOpen ? "rotate-90" : ""}`} />
          <span className="min-w-0">
            <span className="block truncate font-semibold text-slate-950">{decision.title}</span>
            <span className="mt-1 block text-xs text-slate-500">
              {decision.confirmedProfileIds.length}/{decision.requiredProfileIds.length} bestätigt · {linkedTasks.length} Folgeaufgaben · {auditEntries.length} Audit-Einträge
            </span>
          </span>
        </button>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700">{decisionStatusLabel(decision.status)}</span>
          <button type="button" onClick={onCreateFollowUp} className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-700">
            Folgeaufgabe
          </button>
          {canCreate && decision.status !== "locked" && (
            <button type="button" onClick={onToggleEdit} className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-700">
              {isEditing ? "Schließen" : "Editieren"}
            </button>
          )}
        </div>
      </div>
      {isOpen && (
        <>
          <p className="mt-3 text-sm leading-6 text-slate-600">{decision.context || "Kein Kontext hinterlegt."}</p>
          <div className="mt-3 text-sm text-slate-700">{decision.decision || "Noch keine finale Entscheidung."}</div>
          <DecisionFollowUpList linkedTasks={linkedTasks} pending={pending} onRemoveDecisionTaskLink={onRemoveDecisionTaskLink} />
          {isEditing && <DecisionEditForm draft={editDraft} pending={pending} profiles={profiles} onDraftChange={onEditDraftChange} onSubmit={onEditSubmit} />}
          <DecisionConfirmationStrip currentProfileId={currentProfileId} decision={decision} pending={pending} profiles={profiles} onConfirm={onConfirm} />
          {decision.status !== "locked" && currentProfileId && (
            <DecisionObjectionForm objectionText={objectionText} pending={pending} onObjectionChange={onObjectionChange} onSubmit={onObjectSubmit} />
          )}
          <DecisionCommentsList comments={comments} profiles={profiles} />
          <DecisionAuditTrail auditEntries={auditEntries} auditOpen={auditOpen} profiles={profiles} onToggleAudit={onToggleAudit} />
        </>
      )}
    </article>
  );
}
