"use client";

import { Paperclip } from "lucide-react";
import { useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { TaskCommentDraft } from "@/features/tasks/model/task-comment-draft";
import { TaskMentionTextArea } from "@/features/tasks/molecules/task-mention-textarea";
import { TaskCommentStatusHelp } from "@/features/tasks/atoms/task-comment-status-help";
import type { Profile } from "@/lib/types";
import { UiButton } from "@/shared/atoms/ui-primitives";

type Props = {
  draft?: TaskCommentDraft;
  pending?: boolean;
  attachmentConfirmationPending?: boolean;
  profiles?: Profile[];
  onAddComment: (comment: string) => import("@/features/tasks/model/task-comment-creation").TaskCommentCapture;
  onUploadAttachment?: (file: File) => Promise<string>;
  renderPreview: (value: string) => ReactNode;
};

export function TaskCommentComposer({ draft, pending = false, attachmentConfirmationPending = false, profiles = [], onAddComment, onUploadAttachment, renderPreview }: Props) {
  const textareaId = useId();
  const [localComment, setLocalComment] = useState("");
  const newComment = draft?.text ?? localComment;
  const setNewComment = draft?.update ?? setLocalComment;
  const [uploadPending, setUploadPending] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [uploadError, setUploadError] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const showCommentPreview = /!\[[^\]]*\]\(https?:\/\/|https?:\/\/|\[[^\]]+\]\(https?:\/\//.test(newComment);

  async function uploadAttachment(file: File) {
    if (!onUploadAttachment) return;

    setUploadPending(true);
    setUploadError("");
    try {
      const markdown = await onUploadAttachment(file);
      setNewComment((current) => `${current.trimEnd()}${current.trim() ? "\n\n" : ""}${markdown}`);
    } catch (caught) {
      setUploadError(caught instanceof Error ? caught.message : "Anhang konnte nicht hochgeladen werden.");
    } finally {
      setUploadPending(false);
    }
  }

  function submitComment() {
    const capture = onAddComment(newComment);
    if (!capture.accepted) { setSubmitError(capture.error); return; }
    setSubmitError("");
    if (draft) draft.clear();
    else setLocalComment("");
    document.getElementById(textareaId)?.focus({ preventScroll: true });
  }

  return (
    <div className="relative mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
      <label htmlFor={textareaId} className="text-sm font-semibold text-slate-900">Kommentar oder Update</label>
      <TaskMentionTextArea
        id={textareaId}
        profiles={profiles}
        value={newComment}
        onValueChange={setNewComment}
        minHeight="xl"
        inputPadding="md"
        leading="relaxed"
        className="mt-2 min-h-28 w-full resize-y rounded-md border border-slate-200 bg-white p-3 text-sm leading-6 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
        placeholder="Zum Beispiel: Entscheidung, Nachfrage oder Arbeitsfortschritt"
      />
      {showCommentPreview && (
        <div className="mt-2 min-w-0 overflow-hidden rounded-md border border-slate-200 bg-slate-50 p-3">
          <div className="mb-2 text-xs font-semibold text-slate-500">Vorschau</div>
          {renderPreview(newComment)}
        </div>
      )}
      {submitError && <div role="alert" className="mt-2 flex items-center gap-1 text-xs font-semibold text-red-700">
        <span>Nicht gesendet.</span>
        <TaskCommentStatusHelp label="Details zum Sendeversuch"><p>{submitError}</p></TaskCommentStatusHelp>
      </div>}
      {uploadError && <div className="mt-2 rounded-md border border-red-100 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">{uploadError}</div>}
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          {onUploadAttachment && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml,application/pdf,text/plain,text/markdown"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) void uploadAttachment(file);
                }}
              />
              <UiButton
                type="button"
                size="lg"
                disabled={pending || uploadPending || attachmentConfirmationPending}
                onClick={() => fileInputRef.current?.click()}
              >
                <Paperclip size={15} />
                {uploadPending ? "Lädt hoch …" : "Datei anhängen"}
              </UiButton>
            </>
          )}
        </div>
        <UiButton
          type="button"
          size="lg"
          variant="primary"
          disabled={pending || uploadPending || newComment.trim().length < 2}
          onClick={() => void submitComment()}
        >
          Kommentieren
        </UiButton>
      </div>
    </div>
  );
}
