"use client";

import { Paperclip } from "lucide-react";
import { useRef, useState } from "react";
import type { ReactNode } from "react";
import type { Profile } from "@/lib/types";
import { UiButton } from "@/shared/atoms/ui-primitives";

type Props = {
  pending?: boolean;
  profiles?: Profile[];
  onAddComment: (comment: string) => Promise<void> | void;
  onUploadAttachment?: (file: File) => Promise<string>;
  renderPreview: (value: string) => ReactNode;
};

export function TaskCommentComposer({ pending = false, profiles = [], onAddComment, onUploadAttachment, renderPreview }: Props) {
  const [newComment, setNewComment] = useState("");
  const [uploadPending, setUploadPending] = useState(false);
  const [submitPending, setSubmitPending] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const showCommentPreview = /!\[[^\]]*\]\(https?:\/\/|https?:\/\/|\[[^\]]+\]\(https?:\/\//.test(newComment);
  const activeMentionMatch = newComment.match(/(?:^|\s)@([\p{L}\p{N}._-]{0,30})$/u);
  const mentionQuery = activeMentionMatch?.[1]?.toLowerCase() || "";
  const mentionOptions = activeMentionMatch
    ? profiles
      .filter((profile) => profile.name.toLowerCase().includes(mentionQuery) || profile.id.toLowerCase().includes(mentionQuery) || profile.githubLogin.toLowerCase().includes(mentionQuery))
      .slice(0, 6)
    : [];

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

  async function submitComment() {
    const comment = newComment;
    setSubmitPending(true);
    try {
      await onAddComment(comment);
      setNewComment((current) => current === comment ? "" : current);
    } catch {
      // The owning workflow surfaces the error; keep the draft unchanged for retry.
    } finally {
      setSubmitPending(false);
    }
  }

  function insertMention(profile: Profile) {
    const mention = `@${profile.name.split(/\s+/u)[0] || profile.id}`;
    setNewComment((current) => current.replace(/(^|\s)@[\p{L}\p{N}._-]{0,30}$/u, `$1${mention} `));
  }

  return (
    <>
      <textarea
        value={newComment}
        onChange={(event) => setNewComment(event.target.value)}
        className="mt-3 min-h-24 w-full resize-y rounded-md border border-slate-200 p-3 text-sm leading-6 outline-none focus:border-blue-400"
        placeholder="Kommentar, Nachfrage oder kurzes Arbeitsupdate"
      />
      {mentionOptions.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2 rounded-md border border-blue-100 bg-blue-50 p-2">
          {mentionOptions.map((profile) => (
            <button
              key={profile.id}
              type="button"
              onClick={() => insertMention(profile)}
              className="h-7 rounded-md border border-blue-200 bg-white px-2 text-xs font-semibold text-blue-700 hover:bg-blue-100"
            >
              @{profile.name}
            </button>
          ))}
        </div>
      )}
      {showCommentPreview && (
        <div className="mt-2 min-w-0 overflow-hidden rounded-md border border-slate-200 bg-slate-50 p-3">
          <div className="mb-2 text-xs font-semibold text-slate-500">Vorschau</div>
          {renderPreview(newComment)}
        </div>
      )}
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
                disabled={pending || uploadPending}
                onClick={() => fileInputRef.current?.click()}
              >
                <Paperclip size={15} />
                {uploadPending ? "Lädt hoch..." : "Anhang"}
              </UiButton>
            </>
          )}
        </div>
        <UiButton
          type="button"
          disabled={pending || submitPending || uploadPending || newComment.trim().length < 2}
          onClick={() => void submitComment()}
        >
          {submitPending ? "Speichert..." : "Kommentieren"}
        </UiButton>
      </div>
    </>
  );
}
