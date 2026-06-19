import { NextResponse, type NextRequest } from "next/server";
import { cleanText } from "@/lib/api-input";
import { requireFounder } from "@/lib/authz";
import { createGitHubIssueComment } from "@/lib/github";
import { requireMatchingGitHubProviderToken } from "@/lib/github-provider-auth";
import { mentionedProfileIds } from "@/lib/mentions";
import { getServerSupabase } from "@/lib/supabase";

type CommentPayload = {
  comment?: string;
};

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: "Supabase env is not configured." }, { status: 501 });

  const permission = await requireFounder(request);
  if (!permission.ok) return NextResponse.json({ error: permission.error }, { status: permission.status });

  const { id } = await context.params;
  const payload = (await request.json()) as CommentPayload;
  const comment = cleanText(payload.comment, 4000);

  if (comment.length < 2) {
    return NextResponse.json({ error: "Kommentar ist erforderlich." }, { status: 400 });
  }

  const { data: task, error: taskError } = await supabase
    .from("tasks")
    .select("id,title,owner,github_issue_number,github_issue_url,issue_number,issue_url")
    .eq("id", id)
    .single();

  if (taskError || !task) return NextResponse.json({ error: "Aufgabe wurde nicht gefunden." }, { status: 404 });

  const githubIssueNumber = Number(task.github_issue_number || task.issue_number || 0);
  const hasLinkedGitHubIssue = Number.isInteger(githubIssueNumber) && githubIssueNumber > 0;

  const { data: created, error: insertError } = await supabase
    .from("task_comments")
    .insert({
      task_id: id,
      profile_id: permission.profile?.id || null,
      comment,
    })
    .select("id,task_id,profile_id,comment,created_at")
    .single();

  if (insertError || !created) return NextResponse.json({ error: insertError?.message || "Kommentar konnte nicht gespeichert werden." }, { status: 500 });

  let githubSyncError = "";
  if (hasLinkedGitHubIssue) {
    try {
      const githubUserToken = await requireMatchingGitHubProviderToken(request, permission.profile, "GitHub User-Token fehlt. Bitte erneut mit GitHub anmelden und kommentieren.");
      await createGitHubIssueComment(githubIssueNumber, comment, githubUserToken, `fmd-comment-id:${created.id}`);
    } catch (syncError) {
      githubSyncError = syncError instanceof Error ? syncError.message : "GitHub Kommentar konnte nicht erstellt werden.";
    }
  }

  const { data: profiles } = await supabase.from("profiles").select("id,name,github_login,platform_role");
  const mentionedRecipients = new Set(mentionedProfileIds(
    comment,
    (profiles || []).map((profile) => ({
      id: profile.id,
      name: profile.name,
      githubLogin: profile.github_login,
    })),
    permission.profile?.id || "",
  ));

  const recipients = new Set<string>();
  if (task.owner && task.owner !== permission.profile?.id && !mentionedRecipients.has(task.owner)) recipients.add(task.owner);

  const leads = (profiles || []).filter((profile) => ["ceo", "deputy"].includes(profile.platform_role));
  leads?.forEach((lead) => {
    if (lead.id !== permission.profile?.id && !mentionedRecipients.has(lead.id)) recipients.add(lead.id);
  });

  const notificationEvents = [
    ...[...mentionedRecipients].map((recipientId) => ({
      type: "task.mention",
      actor_profile_id: permission.profile?.id || null,
      recipient_profile_id: recipientId,
      entity_type: "task",
      entity_id: id,
      title: `Du wurdest erwähnt: ${task.title}`,
      body: comment,
    })),
    ...[...recipients].map((recipientId) => ({
      type: "task.comment",
      actor_profile_id: permission.profile?.id || null,
      recipient_profile_id: recipientId,
      entity_type: "task",
      entity_id: id,
      title: `Neuer Kommentar: ${task.title}`,
      body: comment,
    })),
  ];

  if (notificationEvents.length) {
    await supabase.from("notification_events").insert(
      notificationEvents,
    );
  }

  await supabase.from("task_activity").insert({
    task_id: id,
    message: `Kommentar hinzugefügt: ${comment.slice(0, 160)}`,
  });

  await supabase.from("tasks").update({
    github_sync_status: githubSyncError ? "failed" : "not_synced",
    github_sync_error: githubSyncError || null,
  }).eq("id", id);

  return NextResponse.json({
    ok: true,
    comment: {
      id: created.id,
      taskId: created.task_id,
      profileId: created.profile_id || "",
      comment: created.comment,
      createdAt: created.created_at,
    },
    githubSyncError,
  });
}
