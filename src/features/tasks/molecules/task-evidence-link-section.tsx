"use client";

import { CommentBody } from "@/features/tasks/atoms/task-comment-body";

type Props = {
  canEdit?: boolean;
  evidenceLink: string;
  pending?: boolean;
  onEvidenceLinkChange: (evidenceLink: string) => void;
  onEvidenceLinkSave: () => void;
};

export function TaskEvidenceLinkSection({ canEdit = true, evidenceLink, pending = false, onEvidenceLinkChange, onEvidenceLinkSave }: Props) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-slate-950">Evidence Link</h3>
      <input
        value={evidenceLink}
        disabled={!canEdit || pending}
        onChange={(event) => onEvidenceLinkChange(event.target.value)}
        onBlur={onEvidenceLinkSave}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
        className="mt-2 h-9 w-full rounded-md border border-slate-200 px-3 text-sm outline-none focus:border-blue-400 disabled:bg-slate-50 disabled:text-slate-500"
        placeholder="Notion, Drive, GitHub oder Evidence-Link"
      />
      {evidenceLink && (
        <div className="mt-3 rounded-md border border-slate-100 bg-slate-50 px-3 py-2">
          <CommentBody value={evidenceLink} />
        </div>
      )}
    </div>
  );
}
