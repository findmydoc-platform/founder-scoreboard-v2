"use client";

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction, type TransitionStartFunction } from "react";
import { createTaskCommentRequest, importGitHubCommentsRequest, uploadTaskAttachmentRequest } from "@/features/tasks/model/task-api-client";
import type { BrowserApiClient } from "@/lib/browser-api-client";
import { hasGitHubIssue } from "@/lib/platform";
import type { EditableTaskState } from "@/features/tasks/model/task-detail-state";
import type { Profile, Task, TaskActivity, TaskComment, TaskExternalComment } from "@/lib/types";

export function useTaskComments({
  task,
  initialComments,
  initialExternalComments,
  initialActivities,
  commentImportNotice,
  profiles,
  apiClient,
  source,
  startTransition,
  setError,
  setMeta,
}: {
  task: Task;
  initialComments: TaskComment[];
  initialExternalComments: TaskExternalComment[];
  initialActivities: TaskActivity[];
  commentImportNotice: string;
  profiles: Profile[];
  apiClient: BrowserApiClient;
  source: "seed" | "supabase";
  startTransition: TransitionStartFunction;
  setError: (message: string) => void;
  setMeta: Dispatch<SetStateAction<EditableTaskState>>;
}) {
  const [taskComments, setTaskComments] = useState(initialComments);
  const [taskExternalComments, setTaskExternalComments] = useState(initialExternalComments);
  const [taskActivities, setTaskActivities] = useState(initialActivities);
  const [localCommentImportNotice, setLocalCommentImportNotice] = useState(commentImportNotice);
  const [githubCommentImportPending, setGithubCommentImportPending] = useState(false);
  const autoImportedGitHubCommentsRef = useRef(false);

  const appendTaskActivities = useCallback((activities: TaskActivity[]) => {
    if (activities.length) setTaskActivities((current) => [...activities, ...current]);
  }, []);

  const addComment = (comment: string) => {
    setError("");

    if (source !== "supabase") {
      setTaskComments((current) => [
        {
          id: Date.now(),
          taskId: task.id,
          profileId: profiles[0]?.id || "",
          comment,
          createdAt: new Date().toISOString(),
        },
        ...current,
      ]);
      return;
    }

    setGithubCommentImportPending(true);
    startTransition(async () => {
      try {
        const { response, body } = await createTaskCommentRequest(apiClient, task.id, comment);

        if (!response.ok || !body?.comment) throw new Error(body?.error || "Kommentar konnte nicht gespeichert werden.");
        setTaskComments((current) => [body.comment!, ...current]);
        if (body.githubSyncError) {
          setError(`Kommentar gespeichert, aber GitHub-Sync ist fehlgeschlagen: ${body.githubSyncError}`);
        }
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Kommentar konnte nicht gespeichert werden.");
      }
    });
  };

  const uploadAttachment = async (file: File) => {
    setError("");

    if (source !== "supabase") {
      throw new Error("Anhänge können nur mit Supabase- und GitHub-Login hochgeladen werden.");
    }

    const { response, body } = await uploadTaskAttachmentRequest(apiClient, task.id, file);
    if (!response.ok || !body?.markdown) throw new Error(body?.error || "Anhang konnte nicht hochgeladen werden.");
    appendTaskActivities([
      {
        id: Date.now(),
        taskId: task.id,
        message: `Anhang hochgeladen: ${file.name}`,
        createdAt: new Date().toISOString(),
      },
    ]);
    return body.markdown;
  };

  const importGitHubComments = useCallback((options: { silent?: boolean } = {}) => {
    if (!options.silent) {
      setError("");
      setLocalCommentImportNotice("");
    }

    if (source !== "supabase") {
      if (!options.silent) setError("GitHub-Kommentarimport ist in diesem Arbeitsmodus nicht verfügbar.");
      return;
    }

    startTransition(async () => {
      try {
        const { response, body } = await importGitHubCommentsRequest(apiClient, task.id);

        if (!response.ok || !body?.comments) throw new Error(body?.error || "GitHub-Kommentare konnten nicht aktualisiert werden.");
        setTaskExternalComments(body.comments);
        if (body.evidenceLink) {
          setMeta((current) => ({ ...current, evidenceLink: body.evidenceLink || current.evidenceLink }));
        }
        const total = body.comments.length;
        setLocalCommentImportNotice(
          total > 0
            ? `GitHub-Kommentare geladen: ${total} Kommentar${total === 1 ? "" : "e"}.`
            : "GitHub wurde geprüft, aber für dieses Issue wurden keine externen Kommentare gefunden.",
        );
      } catch (caught) {
        if (!options.silent) setError(caught instanceof Error ? caught.message : "GitHub-Kommentare konnten nicht aktualisiert werden.");
      } finally {
        setGithubCommentImportPending(false);
      }
    });
  }, [apiClient, setError, setMeta, source, startTransition, task.id]);

  useEffect(() => {
    if (source !== "supabase") return;
    if (!hasGitHubIssue(task)) return;
    if (autoImportedGitHubCommentsRef.current) return;

    autoImportedGitHubCommentsRef.current = true;
    importGitHubComments({ silent: true });
  }, [importGitHubComments, source, task]);

  return {
    taskComments,
    taskExternalComments,
    taskActivities,
    localCommentImportNotice,
    githubCommentImportPending,
    addComment,
    uploadAttachment,
    importGitHubComments,
    appendTaskActivities,
  };
}
