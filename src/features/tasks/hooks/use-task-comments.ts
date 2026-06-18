"use client";

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction, type TransitionStartFunction } from "react";
import { getRememberedGitHubProviderToken, rememberGitHubProviderToken } from "@/lib/github-provider-token";
import { hasGitHubIssue } from "@/lib/platform";
import { getBrowserSupabase } from "@/lib/supabase";
import type { EditableTaskState } from "@/features/tasks/model/task-detail-state";
import type { PlanningData, Profile, Task, TaskActivity, TaskComment, TaskExternalComment } from "@/lib/types";

export function useTaskComments({
  task,
  initialComments,
  initialExternalComments,
  initialActivities,
  commentImportNotice,
  profiles,
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
      const session = await getBrowserSupabase()?.auth.getSession();
      const token = session?.data.session?.access_token;
      rememberGitHubProviderToken(session?.data.session?.provider_token);
      const githubProviderToken = getRememberedGitHubProviderToken();

      try {
        const response = await fetch(`/api/tasks/${task.id}/comments`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
            ...(githubProviderToken ? { "x-github-provider-token": githubProviderToken } : {}),
          },
          body: JSON.stringify({ comment }),
        });

        const body = (await response.json().catch(() => null)) as { error?: string; githubSyncError?: string; comment?: PlanningData["taskComments"][number] } | null;
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

    const session = await getBrowserSupabase()?.auth.getSession();
    const token = session?.data.session?.access_token;
    rememberGitHubProviderToken(session?.data.session?.provider_token);
    const githubProviderToken = getRememberedGitHubProviderToken();
    const formData = new FormData();
    formData.append("file", file);

    const response = await fetch(`/api/tasks/${task.id}/attachments`, {
      method: "POST",
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(githubProviderToken ? { "x-github-provider-token": githubProviderToken } : {}),
      },
      body: formData,
    });

    const body = (await response.json().catch(() => null)) as { error?: string; markdown?: string } | null;
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
      if (!options.silent) setError("GitHub-Kommentarimport ist nur mit Supabase-Datenquelle verfügbar.");
      return;
    }

    startTransition(async () => {
      const session = await getBrowserSupabase()?.auth.getSession();
      const token = session?.data.session?.access_token;
      rememberGitHubProviderToken(session?.data.session?.provider_token);
      const githubProviderToken = getRememberedGitHubProviderToken();

      try {
        const response = await fetch(`/api/tasks/${task.id}/github-comments`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
            ...(githubProviderToken ? { "x-github-provider-token": githubProviderToken } : {}),
          },
        });

        const body = (await response.json().catch(() => null)) as { error?: string; imported?: number; evidenceLink?: string; comments?: TaskExternalComment[] } | null;
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
  }, [setError, setMeta, source, startTransition, task.id]);

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
