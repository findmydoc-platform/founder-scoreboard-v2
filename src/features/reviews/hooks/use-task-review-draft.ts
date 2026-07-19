"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReviewDecision, TaskReviewChecklist } from "@/lib/types";

export type TaskReviewDraft = {
  checklist: TaskReviewChecklist;
  comment: string;
  decision: ReviewDecision | "";
};

const emptyDraft: TaskReviewDraft = {
  checklist: {
    acceptanceCriteriaMet: false,
    evidenceProvided: false,
    communicationClear: false,
    blockerHandled: false,
  },
  comment: "",
  decision: "",
};

function legacyDraftStorageKey(taskId: string) {
  return `founderops:task-review-draft:v1:${taskId}`;
}

function draftStorageKey(taskId: string, reviewRequestedAt: string, profileId: string) {
  return `founderops:task-review-draft:v2:${taskId}:${encodeURIComponent(reviewRequestedAt || "unknown")}:${encodeURIComponent(profileId || "anonymous")}`;
}

function loadDraft(storageKey: string): TaskReviewDraft {
  if (typeof window === "undefined") return emptyDraft;
  try {
    const stored = window.sessionStorage.getItem(storageKey);
    if (!stored) return emptyDraft;
    const parsed = JSON.parse(stored) as Partial<TaskReviewDraft>;
    return {
      checklist: { ...emptyDraft.checklist, ...(parsed.checklist || {}) },
      comment: typeof parsed.comment === "string" ? parsed.comment : "",
      decision: parsed.decision === "accepted" || parsed.decision === "partial" || parsed.decision === "changes_requested" ? parsed.decision : "",
    };
  } catch {
    return emptyDraft;
  }
}

export function clearTaskReviewDraft(taskId: string, reviewRequestedAt: string, profileId: string) {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(draftStorageKey(taskId, reviewRequestedAt, profileId));
  window.sessionStorage.removeItem(legacyDraftStorageKey(taskId));
}

export function useTaskReviewDraft(taskId: string, reviewRequestedAt: string, profileId: string) {
  const storageKey = draftStorageKey(taskId, reviewRequestedAt, profileId);
  const [draft, setDraft] = useState<TaskReviewDraft>(() => loadDraft(storageKey));

  useEffect(() => {
    window.sessionStorage.removeItem(legacyDraftStorageKey(taskId));
    window.sessionStorage.setItem(storageKey, JSON.stringify(draft));
  }, [draft, storageKey, taskId]);

  const dirty = useMemo(() => Boolean(
    draft.comment.trim()
    || draft.decision
    || Object.values(draft.checklist).some(Boolean)
  ), [draft]);

  return { draft, dirty, setDraft };
}
