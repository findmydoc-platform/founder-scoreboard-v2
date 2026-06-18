import type { DecisionComment } from "@/features/decisions/model/decision-log-view-model";
import { formatDate } from "@/lib/display";
import type { Profile } from "@/lib/types";

type DecisionCommentsListProps = {
  comments: DecisionComment[];
  profiles: Profile[];
};

export function DecisionCommentsList({ comments, profiles }: DecisionCommentsListProps) {
  if (!comments.length) return null;

  return (
    <div className="mt-3 grid gap-2">
      {comments.map((comment) => {
        const actor = profiles.find((profile) => profile.id === comment.profileId)?.name || comment.profileId || "Unbekannt";
        return (
          <div key={comment.id} className="rounded-md border border-amber-100 bg-amber-50/60 px-3 py-2 text-xs leading-5 text-amber-900">
            <span className="font-semibold">{comment.type === "objection" ? "Einwand" : "Kommentar"} · {actor} · {formatDate(comment.createdAt)}:</span> {comment.comment}
          </div>
        );
      })}
    </div>
  );
}
