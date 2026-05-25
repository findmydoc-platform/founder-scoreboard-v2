"use client";

import { MessageSquare } from "lucide-react";
import { useState } from "react";
import type { Profile, TaskComment } from "@/lib/types";

type Props = {
  comments: TaskComment[];
  profiles: Profile[];
  pending?: boolean;
  title?: string;
  description?: string;
  onAddComment: (comment: string) => void;
};

function formatDateTime(value: string) {
  if (!value) return "";
  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function TaskCommentThread({
  comments,
  profiles,
  pending = false,
  title = "Kommunikation",
  description = "Fragen, Updates und Abstimmungen zur Aufgabe bleiben hier nachvollziehbar.",
  onAddComment,
}: Props) {
  const [newComment, setNewComment] = useState("");
  const profileName = (profileId: string) => profiles.find((profile) => profile.id === profileId)?.name || profileId || "Unbekannt";

  return (
    <section className="rounded-lg border border-slate-200 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-950">
            <MessageSquare size={16} />
            {title}
          </h3>
          <p className="mt-1 text-xs text-slate-500">{description}</p>
        </div>
        <span className="rounded-full border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-600">
          {comments.length} Kommentare
        </span>
      </div>

      <div className="mt-3 grid gap-2">
        {comments.map((comment) => (
          <article key={comment.id} className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2 text-sm">
            <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
              <span className="font-semibold text-slate-700">{profileName(comment.profileId)}</span>
              <span>{formatDateTime(comment.createdAt)}</span>
            </div>
            <p className="mt-1 whitespace-pre-wrap leading-6 text-slate-700">{comment.comment}</p>
          </article>
        ))}
        {!comments.length && (
          <div className="rounded-md border border-dashed border-slate-200 px-3 py-4 text-center text-sm text-slate-500">
            Noch keine Kommentare oder Nachfragen.
          </div>
        )}
      </div>

      <textarea
        value={newComment}
        onChange={(event) => setNewComment(event.target.value)}
        className="mt-3 min-h-24 w-full resize-y rounded-md border border-slate-200 p-3 text-sm leading-6 outline-none focus:border-blue-400"
        placeholder="Kommentar, Nachfrage oder kurzes Arbeitsupdate"
      />
      <div className="mt-2 flex justify-end">
        <button
          type="button"
          disabled={pending || newComment.trim().length < 2}
          onClick={() => {
            onAddComment(newComment);
            setNewComment("");
          }}
          className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Kommentieren
        </button>
      </div>
    </section>
  );
}
