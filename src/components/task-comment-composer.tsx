"use client";

import { Paperclip } from "lucide-react";
import { useRef, useState } from "react";
import type { ReactNode } from "react";

type Props = {
  pending?: boolean;
  onAddComment: (comment: string) => void;
  onUploadAttachment?: (file: File) => Promise<string>;
  renderPreview: (value: string) => ReactNode;
};

export function TaskCommentComposer({ pending = false, onAddComment, onUploadAttachment, renderPreview }: Props) {
  const [newComment, setNewComment] = useState("");
  const [uploadPending, setUploadPending] = useState(false);
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
    onAddComment(newComment);
    setNewComment("");
  }

  return (
    <>
      <textarea
        value={newComment}
        onChange={(event) => setNewComment(event.target.value)}
        className="mt-3 min-h-24 w-full resize-y rounded-md border border-slate-200 p-3 text-sm leading-6 outline-none focus:border-blue-400"
        placeholder="Kommentar, Nachfrage oder kurzes Arbeitsupdate"
      />
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
              <button
                type="button"
                disabled={pending || uploadPending}
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Paperclip size={15} />
                {uploadPending ? "Lädt hoch..." : "Anhang"}
              </button>
            </>
          )}
        </div>
        <button
          type="button"
          disabled={pending || uploadPending || newComment.trim().length < 2}
          onClick={submitComment}
          className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Kommentieren
        </button>
      </div>
    </>
  );
}
