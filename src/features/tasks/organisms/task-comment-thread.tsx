"use client";

import { MessageSquare, RefreshCw } from "lucide-react";
import { CommentBody } from "@/features/tasks/atoms/task-comment-body";
import { TaskCommentComposer } from "@/features/tasks/molecules/task-comment-composer";
import { TaskCommentTimeline } from "@/features/tasks/molecules/task-comment-timeline";
import type { TaskCommentTimelineItem } from "@/features/tasks/molecules/task-comment-timeline";
import { isUsefulTaskActivity } from "@/features/tasks/model/task-detail-presentation";
import type { Profile, TaskActivity, TaskComment, TaskExternalComment } from "@/lib/types";

type Props = {
  comments: TaskComment[];
  externalComments?: TaskExternalComment[];
  activities?: TaskActivity[];
  profiles: Profile[];
  currentProfileId?: string;
  pending?: boolean;
  importPending?: boolean;
  notice?: string;
  readOnly?: boolean;
  title?: string;
  description?: string;
  onAddComment: (comment: string) => Promise<void> | void;
  onImportGitHubComments?: () => void;
  onUploadAttachment?: (file: File) => Promise<string>;
};

function buildTimeline(comments: TaskComment[], externalComments: TaskExternalComment[], activities: TaskActivity[]): TaskCommentTimelineItem[] {
  const visibleActivities = activities.filter((activity) => isUsefulTaskActivity(activity.message));
  return [
    ...visibleActivities.map((activity) => ({
      id: `activity-${activity.id}`,
      type: "activity" as const,
      createdAt: activity.createdAt,
      message: activity.message,
      profileId: "",
      comment: "",
      authorLogin: "",
      authorAvatarUrl: "",
      htmlUrl: "",
    })),
    ...comments.map((comment) => ({
      id: `comment-${comment.id}`,
      type: "comment" as const,
      createdAt: comment.createdAt,
      message: "",
      profileId: comment.profileId,
      comment: comment.comment,
      authorLogin: "",
      authorAvatarUrl: "",
      htmlUrl: "",
      githubDeliveryStatus: comment.githubDeliveryStatus,
      githubCommentUrl: comment.githubCommentUrl,
    })),
    ...externalComments.map((comment) => ({
      id: `github-comment-${comment.id}`,
      type: "github-comment" as const,
      createdAt: comment.createdAt,
      message: "",
      profileId: "",
      comment: comment.body,
      authorLogin: comment.authorLogin,
      authorAvatarUrl: comment.authorAvatarUrl,
      htmlUrl: comment.htmlUrl,
      githubDeliveryStatus: "delivered" as const,
      githubCommentUrl: comment.htmlUrl,
    })),
  ].sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
}

export function TaskCommentThread({
  comments,
  externalComments = [],
  activities = [],
  profiles,
  currentProfileId = "",
  pending = false,
  importPending = false,
  notice = "",
  readOnly = false,
  title = "Kommunikation",
  description = "Fragen, Updates und Abstimmungen zur Aufgabe bleiben hier nachvollziehbar.",
  onAddComment,
  onImportGitHubComments,
  onUploadAttachment,
}: Props) {
  const visibleActivities = activities.filter((activity) => isUsefulTaskActivity(activity.message));
  const timeline = buildTimeline(comments, externalComments, visibleActivities);

  return (
    <section className="min-w-0 overflow-hidden rounded-lg border border-slate-200 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-950">
            <MessageSquare size={16} />
            {title}
          </h3>
          <p className="mt-1 text-xs text-slate-500">{description}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!readOnly && onImportGitHubComments && (
            <button
              type="button"
              onClick={onImportGitHubComments}
              disabled={pending || importPending}
              className="inline-flex h-8 items-center gap-2 rounded-md border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RefreshCw size={13} />
              {importPending ? "Aktualisiert..." : "GitHub aktualisieren"}
            </button>
          )}
          <span className="rounded-full border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-600">{timeline.length} Einträge</span>
        </div>
      </div>

      {notice && (
        <div className="mt-3 rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700">
          {notice}
        </div>
      )}
      {!notice && importPending && (
        <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">
          GitHub-Kommentare und Anhänge werden geprüft...
        </div>
      )}

      {!readOnly && (
        <TaskCommentComposer
          pending={pending}
          profiles={profiles}
          onAddComment={onAddComment}
          onUploadAttachment={onUploadAttachment}
          renderPreview={(value) => <CommentBody value={value} />}
        />
      )}
      <TaskCommentTimeline items={timeline} profiles={profiles} currentProfileId={currentProfileId} />
    </section>
  );
}
