import { TaskReviewSheet } from "@/features/reviews/organisms/task-review-sheet";
import type { Task } from "@/lib/types";

type ReviewStatus = "accepted" | "partial" | "changes_requested";
type ReviewChecklist = {
  acceptanceCriteriaMet?: boolean;
  dodMet?: boolean;
  evidenceProvided?: boolean;
  communicationClear?: boolean;
  blockerHandled?: boolean;
};

export function SprintReviewSheetSection({
  selectedReviewTask,
  reviewOwnerName,
  canReview,
  canReopen,
  pending,
  onReview,
  onReopen,
  onOpenTask,
}: {
  selectedReviewTask?: Task;
  reviewOwnerName: (task: Task) => string;
  canReview: (task: Task) => boolean;
  canReopen: (task: Task) => boolean;
  pending: boolean;
  onReview: (task: Task, reviewStatus: ReviewStatus, scorePoints: number, checklist?: ReviewChecklist, comment?: string) => void;
  onReopen: (task: Task) => void;
  onOpenTask: (taskId: string) => void;
}) {
  if (!selectedReviewTask) return null;

  return (
    <TaskReviewSheet
      task={selectedReviewTask}
      reviewOwnerName={reviewOwnerName(selectedReviewTask)}
      canReview={canReview(selectedReviewTask)}
      canReopen={canReopen(selectedReviewTask)}
      pending={pending}
      onReview={onReview}
      onReopen={onReopen}
      onOpenTask={onOpenTask}
    />
  );
}
