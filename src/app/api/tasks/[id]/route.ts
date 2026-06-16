import { NextResponse, type NextRequest } from "next/server";
import { requireFounder } from "@/lib/authz";
import { archiveGitHubIssue, githubUserForToken } from "@/lib/github";
import { isOperationalLeadRole } from "@/lib/platform";
import { getServerSupabase } from "@/lib/supabase";
import { taskStatuses } from "@/lib/status";

type UpdatePayload = {
  status?: string;
  owner?: string;
  priority?: string;
  problemStatement?: string;
  intendedOutcome?: string;
  scopeConstraints?: string;
  acceptanceCriteria?: string;
  evidenceRequired?: string;
  definitionOfDone?: string;
  packageId?: string;
  milestoneId?: string;
  startDate?: string;
  endDate?: string;
  deadline?: string;
  dependsOn?: string;
  evidenceLink?: string;
  note?: string;
  reviewStatus?: string;
  scorePoints?: number;
  scoreFinal?: boolean;
  githubSyncStatus?: string;
  sprintId?: string;
  selfDodChecked?: boolean;
  selfEvidenceChecked?: boolean;
  selfDocumentedChecked?: boolean;
  selfBlockersChecked?: boolean;
};

const priorities = new Set(["P0", "P1", "P2", "P3", "P4"]);
const reviewStatuses = new Set(["not_requested", "requested", "accepted", "partial", "changes_requested"]);
const syncStatuses = new Set(["not_synced", "synced", "pending", "failed"]);

function providerToken(request: NextRequest) {
  return request.headers.get("x-github-provider-token")?.trim() || "";
}

function linkedIssueNumber(row: { github_issue_number?: number | null; issue_number?: string | null; github_issue_url?: string | null; issue_url?: string | null }) {
  if (row.github_issue_number) return Number(row.github_issue_number);
  const legacyNumber = Number(row.issue_number);
  if (Number.isInteger(legacyNumber) && legacyNumber > 0) return legacyNumber;
  const url = row.github_issue_url || row.issue_url || "";
  const match = url.match(/\/issues\/(\d+)(?:$|[?#])/);
  return match ? Number(match[1]) : null;
}

async function matchingGitHubToken(request: NextRequest, profile: { githubLogin?: string } | null) {
  const token = providerToken(request);
  if (!token) return "";
  const githubUser = await githubUserForToken(token);
  const expectedLogin = profile?.githubLogin?.toLowerCase() || "";
  if (!expectedLogin || githubUser.login.toLowerCase() !== expectedLogin) {
    throw new Error("GitHub User-Token passt nicht zum angemeldeten Teamprofil.");
  }
  return token;
}

function profileId(value?: string) {
  return value
    ?.normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function taskOwnedByProfile(task: { owner?: string | null }, profile?: { id?: string; name?: string } | null) {
  if (!profile || !task.owner) return false;
  const owner = task.owner;
  return owner === profile.id || owner === profile.name || owner === profileId(profile.name);
}

type CurrentTaskForActivity = {
  task_type?: string | null;
  status?: string | null;
  review_status?: string | null;
  review_owner_profile_id?: string | null;
  review_requested_at?: string | null;
  score_final?: boolean | null;
  owner?: string | null;
  priority?: string | null;
  sprint_id?: string | null;
  milestone_id?: string | null;
  package_id?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  deadline?: string | null;
  evidence_link?: string | null;
};

function formatChange(previous?: string | number | boolean | null, next?: string | number | boolean | null) {
  const before = previous === undefined || previous === null || previous === "" ? "leer" : String(previous);
  const after = next === undefined || next === null || next === "" ? "leer" : String(next);
  return `${before} → ${after}`;
}

function activityMessages(payload: UpdatePayload, currentTask?: CurrentTaskForActivity | null) {
  const messages: string[] = [];
  if (payload.status && currentTask?.status && payload.status !== currentTask.status) {
    messages.push(`Status geändert: ${currentTask.status} → ${payload.status}`);
  }
  if (payload.reviewStatus && currentTask?.review_status && payload.reviewStatus !== currentTask.review_status) {
    messages.push(`Review geändert: ${currentTask.review_status} → ${payload.reviewStatus}`);
  }
  if (payload.owner !== undefined && payload.owner !== currentTask?.owner) messages.push(`Owner geändert: ${formatChange(currentTask?.owner, payload.owner)}`);
  if (payload.priority !== undefined && payload.priority !== currentTask?.priority) messages.push(`Priorität geändert: ${formatChange(currentTask?.priority, payload.priority)}`);
  if (payload.sprintId !== undefined && payload.sprintId !== currentTask?.sprint_id) messages.push(`Sprint-Zuordnung geändert: ${formatChange(currentTask?.sprint_id, payload.sprintId)}`);
  if (payload.milestoneId !== undefined && payload.milestoneId !== currentTask?.milestone_id) messages.push(`Epic / Meilenstein geändert: ${formatChange(currentTask?.milestone_id, payload.milestoneId)}`);
  if (payload.packageId !== undefined && payload.packageId !== currentTask?.package_id) messages.push(`Initiative geändert: ${formatChange(currentTask?.package_id, payload.packageId)}`);
  if (
    (payload.startDate !== undefined && payload.startDate !== currentTask?.start_date)
    || (payload.endDate !== undefined && payload.endDate !== currentTask?.end_date)
    || (payload.deadline !== undefined && payload.deadline !== currentTask?.deadline)
  ) {
    messages.push(`Zeitraum geändert: ${formatChange(currentTask?.start_date, payload.startDate ?? currentTask?.start_date)} bis ${formatChange(currentTask?.end_date, payload.endDate ?? currentTask?.end_date)}`);
  }
  if (payload.problemStatement !== undefined || payload.intendedOutcome !== undefined || payload.scopeConstraints !== undefined || payload.acceptanceCriteria !== undefined || payload.evidenceRequired !== undefined || payload.definitionOfDone !== undefined) messages.push("Aufgabenbrief aktualisiert");
  if (payload.evidenceLink !== undefined && payload.evidenceLink !== currentTask?.evidence_link) messages.push("Evidence-Link geändert");
  if (payload.selfDodChecked !== undefined || payload.selfEvidenceChecked !== undefined || payload.selfDocumentedChecked !== undefined || payload.selfBlockersChecked !== undefined) messages.push("Founder-Checkliste aktualisiert");
  if (payload.note !== undefined) messages.push("Notiz aktualisiert");
  if (payload.dependsOn !== undefined) messages.push("Abhängigkeit aktualisiert");
  return [...new Set(messages)];
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const supabase = getServerSupabase();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase env is not configured. UI changes remain local only." }, { status: 501 });
  }

  const permission = await requireFounder(request);
  if (!permission.ok) {
    return NextResponse.json({ error: permission.error }, { status: permission.status });
  }

  const { id } = await context.params;
  const payload = (await request.json()) as UpdatePayload;
  const update: Record<string, string | number | boolean | null> = {};
  const { data: currentTask } = await supabase
    .from("tasks")
    .select("id,title,task_type,owner,status,review_status,review_owner_profile_id,review_requested_at,score_final,priority,sprint_id,milestone_id,package_id,start_date,end_date,deadline,evidence_link")
    .eq("id", id)
    .single();
  if (!currentTask) {
    return NextResponse.json({ error: "Aufgabe wurde nicht gefunden." }, { status: 404 });
  }
  const isOperationalLead = isOperationalLeadRole(permission.profile?.platformRole);
  const restrictedFields = [
    payload.owner !== undefined ? "Owner" : "",
    payload.priority !== undefined ? "Priorität" : "",
    payload.packageId !== undefined ? "Initiative" : "",
    payload.sprintId !== undefined ? "Sprint" : "",
    payload.milestoneId !== undefined ? "Epic / Meilenstein" : "",
    payload.startDate !== undefined || payload.endDate !== undefined || payload.deadline !== undefined ? "Zeitraum" : "",
    payload.scorePoints !== undefined || payload.scoreFinal !== undefined ? "Score" : "",
  ].filter(Boolean);

  if (!isOperationalLead && restrictedFields.length) {
    return NextResponse.json({ error: `Diese Felder sind geschützt: ${restrictedFields.join(", ")}.` }, { status: 403 });
  }

  if (payload.status) {
    if (!taskStatuses.includes(payload.status as (typeof taskStatuses)[number])) {
      return NextResponse.json({ error: "Ungültiger Status." }, { status: 400 });
    }
    if (!isOperationalLead && !taskOwnedByProfile(currentTask, permission.profile)) {
      return NextResponse.json({ error: "Founder können nur den Status ihrer eigenen Aufgaben ändern." }, { status: 403 });
    }
    if (!isOperationalLead && payload.status === "Erledigt") {
      return NextResponse.json({ error: "Founder können Aufgaben nur in Review geben. Final erledigt wird im CEO-Review gesetzt." }, { status: 403 });
    }
    if (!isOperationalLead && currentTask?.status === "Nacharbeit" && !["In Arbeit", "Review", "Blockiert"].includes(payload.status)) {
      return NextResponse.json({ error: "Nacharbeit kann nur wieder bearbeitet, blockiert oder erneut in Review gegeben werden." }, { status: 403 });
    }
    update.status = payload.status;
  }

  if (payload.priority) {
    if (!priorities.has(payload.priority)) {
      return NextResponse.json({ error: "Ungültige Priorität." }, { status: 400 });
    }
    update.priority = payload.priority;
  }

  if (payload.milestoneId !== undefined) {
    const nextMilestoneId = payload.milestoneId || null;
    if (nextMilestoneId) {
      const { data: milestone, error: milestoneError } = await supabase
        .from("milestones")
        .select("id")
        .eq("id", nextMilestoneId)
        .single();
      if (milestoneError || !milestone) return NextResponse.json({ error: "Meilenstein wurde nicht gefunden." }, { status: 404 });
    }
    update.milestone_id = nextMilestoneId;
  }

  if (payload.packageId !== undefined) {
    const nextPackageId = payload.packageId || null;
    if (nextPackageId) {
      const { data: initiative, error: initiativeError } = await supabase
        .from("packages")
        .select("id,milestone_id")
        .eq("id", nextPackageId)
        .single();
      if (initiativeError || !initiative) return NextResponse.json({ error: "Initiative wurde nicht gefunden." }, { status: 404 });
      update.package_id = nextPackageId;
      if (payload.milestoneId === undefined) update.milestone_id = initiative.milestone_id || null;
    } else {
      update.package_id = null;
    }
  }

  if (payload.owner !== undefined) {
    const nextOwner = profileId(payload.owner);
    if (!nextOwner && currentTask?.task_type !== "proposal") {
      return NextResponse.json({ error: "Nur Vorschläge können ohne Assignee bleiben." }, { status: 400 });
    }
    update.owner = nextOwner || null;
    update.assignee = nextOwner || null;
  }

  if (payload.startDate !== undefined) update.start_date = payload.startDate || null;
  if (payload.endDate !== undefined) update.end_date = payload.endDate || null;
  if (payload.deadline !== undefined) update.deadline = payload.deadline || null;
  if (payload.problemStatement !== undefined) update.problem_statement = payload.problemStatement.trim().slice(0, 4000) || null;
  if (payload.intendedOutcome !== undefined) update.intended_outcome = payload.intendedOutcome.trim().slice(0, 4000) || null;
  if (payload.scopeConstraints !== undefined) update.scope_constraints = payload.scopeConstraints.trim().slice(0, 4000) || null;
  if (payload.acceptanceCriteria !== undefined) update.acceptance_criteria = payload.acceptanceCriteria.trim().slice(0, 6000) || null;
  if (payload.evidenceRequired !== undefined) update.evidence_required = payload.evidenceRequired.trim().slice(0, 4000) || null;
  if (payload.definitionOfDone !== undefined) update.definition_of_done = payload.definitionOfDone.trim().slice(0, 4000) || null;
  if (payload.evidenceLink !== undefined) update.evidence_link = payload.evidenceLink.trim().slice(0, 4000) || null;

  if (payload.sprintId !== undefined) {
    const nextSprintId = payload.sprintId || null;
    if (nextSprintId) {
      const { data: sprint, error: sprintError } = await supabase
        .from("sprints")
        .select("id,score_locked")
        .eq("id", nextSprintId)
        .single();
      if (sprintError || !sprint) return NextResponse.json({ error: "Sprint wurde nicht gefunden." }, { status: 404 });
      if (sprint.score_locked) return NextResponse.json({ error: "Gelockte Sprints können nicht mehr zugewiesen werden." }, { status: 409 });
    }
    update.sprint_id = nextSprintId;
  }

  if (payload.reviewStatus) {
    if (!reviewStatuses.has(payload.reviewStatus)) {
      return NextResponse.json({ error: "Ungültiger Review-Status." }, { status: 400 });
    }
    if (!isOperationalLead && payload.reviewStatus !== "requested") {
      return NextResponse.json({ error: "Founder können Review nur anfragen. Final bewertet wird im CEO-Review." }, { status: 403 });
    }
    update.review_status = payload.reviewStatus;
    update.score_final = ["accepted", "partial", "changes_requested"].includes(payload.reviewStatus);
    if (!isOperationalLead) update.score_final = false;
  }

  if (payload.scorePoints !== undefined) {
    update.score_points = Math.max(0, payload.scorePoints);
  }

  if (payload.scoreFinal !== undefined) {
    update.score_final = Boolean(payload.scoreFinal);
  }

  const startsReviewRequest = payload.status === "Review" || payload.reviewStatus === "requested";
  if (startsReviewRequest) {
    if (currentTask.score_final) {
      return NextResponse.json({ error: "Final bewertete Aufgaben können nicht erneut in Review gegeben werden." }, { status: 409 });
    }

    const reviewPackageId = typeof update.package_id === "string" ? update.package_id : currentTask.package_id || "";
    let reviewOwnerProfileId = "";
    if (reviewPackageId) {
      const { data: initiative, error: initiativeError } = await supabase
        .from("packages")
        .select("owner_id,accountable_profile_id")
        .eq("id", reviewPackageId)
        .maybeSingle();
      if (initiativeError) return NextResponse.json({ error: initiativeError.message }, { status: 500 });
      reviewOwnerProfileId = initiative?.accountable_profile_id || initiative?.owner_id || "";
    }

    update.status = "Review";
    update.review_status = "requested";
    update.score_final = false;
    update.review_owner_profile_id = reviewOwnerProfileId || null;
    update.review_requested_at = new Date().toISOString();
  }

  if (payload.githubSyncStatus) {
    if (!syncStatuses.has(payload.githubSyncStatus)) {
      return NextResponse.json({ error: "Ungültiger GitHub-Sync-Status." }, { status: 400 });
    }
    update.github_sync_status = payload.githubSyncStatus;
  }

  if (payload.selfDodChecked !== undefined) update.self_dod_checked = Boolean(payload.selfDodChecked);
  if (payload.selfEvidenceChecked !== undefined) update.self_evidence_checked = Boolean(payload.selfEvidenceChecked);
  if (payload.selfDocumentedChecked !== undefined) update.self_documented_checked = Boolean(payload.selfDocumentedChecked);
  if (payload.selfBlockersChecked !== undefined) update.self_blockers_checked = Boolean(payload.selfBlockersChecked);

  if (Object.keys(update).length && payload.githubSyncStatus === undefined) {
    update.github_sync_status = "not_synced";
    update.github_sync_error = null;
  }

  if (Object.keys(update).length) {
    const { error } = await supabase.from("tasks").update(update).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (payload.note !== undefined) {
    const { error } = await supabase
      .from("task_notes")
      .upsert({ task_id: id, note: payload.note, updated_at: new Date().toISOString() });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (payload.dependsOn !== undefined) {
    const note = payload.dependsOn.trim().slice(0, 2000);
    const { error: deleteError } = await supabase.from("task_dependencies").delete().eq("task_id", id);
    if (deleteError) return NextResponse.json({ error: deleteError.message }, { status: 500 });
    if (note) {
      const { error: dependencyError } = await supabase.from("task_dependencies").insert({ task_id: id, note });
      if (dependencyError) return NextResponse.json({ error: dependencyError.message }, { status: 500 });
    }
  }

  let activities: Array<{ id: number; taskId: string; message: string; createdAt: string }> = [];
  if (Object.keys(update).length || payload.note !== undefined || payload.dependsOn !== undefined) {
    const messages = activityMessages(payload, currentTask);
    if (messages.length) {
      const { data: activityRows } = await supabase.from("task_activity").insert(
        messages.map((message) => ({
          task_id: id,
          message,
        })),
      ).select("id,task_id,message,created_at");
      activities = (activityRows || []).map((activity) => ({
        id: activity.id,
        taskId: activity.task_id,
        message: activity.message,
        createdAt: activity.created_at,
      }));
    }
  }

  if (currentTask && update.review_status === "requested" && currentTask.review_status !== "requested") {
    const reviewOwnerProfileId = typeof update.review_owner_profile_id === "string" ? update.review_owner_profile_id : "";
    const recipients = reviewOwnerProfileId
      ? [{ id: reviewOwnerProfileId }]
      : (await supabase.from("profiles").select("id").in("platform_role", ["ceo", "deputy"])).data || [];
    const notifications = recipients
      .filter((recipient) => recipient.id !== permission.profile?.id)
      .map((recipient) => ({
        type: "task.review_requested",
        actor_profile_id: permission.profile?.id || null,
        recipient_profile_id: recipient.id,
        entity_type: "task",
        entity_id: id,
        title: `Review angefragt: ${currentTask.title}`,
        body: reviewOwnerProfileId
          ? "Diese Aufgabe wartet auf deine Accountable-Review."
          : "Diese Aufgabe wartet auf Review, hat aber keinen Review Owner.",
      }));
    if (notifications.length) {
      await supabase.from("notification_events").insert(notifications);
    }
  }

  return NextResponse.json({
    ok: true,
    activities,
    task: startsReviewRequest ? {
      id,
      status: "Review",
      reviewStatus: "requested",
      scoreFinal: false,
      reviewOwnerProfileId: update.review_owner_profile_id || "",
      reviewRequestedAt: update.review_requested_at || "",
    } : undefined,
  });
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: "Supabase env is not configured." }, { status: 501 });

  const permission = await requireFounder(request);
  if (!permission.ok) return NextResponse.json({ error: permission.error }, { status: permission.status });
  const isOperationalLead = isOperationalLeadRole(permission.profile?.platformRole);
  if (!isOperationalLead) return NextResponse.json({ error: "Nur CEO oder Deputy können Aufgaben löschen." }, { status: 403 });

  const { id } = await context.params;
  const { data: task, error: taskError } = await supabase
    .from("tasks")
    .select("id,title,github_issue_number,github_issue_url,issue_number,issue_url")
    .eq("id", id)
    .single();
  if (taskError || !task) return NextResponse.json({ error: "Aufgabe wurde nicht gefunden." }, { status: 404 });

  const issueNumber = linkedIssueNumber(task);
  let githubClosed = false;
  if (issueNumber) {
    try {
      const token = await matchingGitHubToken(request, permission.profile);
      if (!token) {
        return NextResponse.json({ error: "Für verknüpfte GitHub-Issues bitte GitHub-Rechte erneuern und dann erneut löschen." }, { status: 409 });
      }
      await archiveGitHubIssue(issueNumber, token);
      githubClosed = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "GitHub Issue konnte nicht geschlossen werden.";
      return NextResponse.json({ error: message }, { status: 502 });
    }
  }

  const { error: deleteError } = await supabase.from("tasks").delete().eq("id", id);
  if (deleteError) return NextResponse.json({ error: deleteError.message }, { status: 500 });

  await supabase.from("audit_log").insert({
    actor_profile_id: permission.profile?.id || null,
    action: "task.delete",
    entity_type: "task",
    entity_id: id,
    before_data: task,
    after_data: { deleted: true, githubClosed },
    request_ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null,
    user_agent: request.headers.get("user-agent"),
  });

  return NextResponse.json({ ok: true, deletedTaskId: id, githubClosed });
}

