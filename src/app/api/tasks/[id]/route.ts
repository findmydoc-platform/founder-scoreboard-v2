import { NextResponse, type NextRequest } from "next/server";
import { requireFounder } from "@/lib/authz";
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
  milestoneId?: string;
  startDate?: string;
  endDate?: string;
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

function profileId(value?: string) {
  return value
    ?.normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
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
    .select("id,title,owner,review_status")
    .eq("id", id)
    .single();

  if (payload.status) {
    if (!taskStatuses.includes(payload.status as (typeof taskStatuses)[number])) {
      return NextResponse.json({ error: "Ungültiger Status." }, { status: 400 });
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

  if (payload.owner) {
    const nextOwner = profileId(payload.owner);
    update.owner = nextOwner || null;
    update.assignee = nextOwner || null;
  }

  if (payload.startDate !== undefined) update.start_date = payload.startDate || null;
  if (payload.endDate !== undefined) update.end_date = payload.endDate || null;
  if (payload.problemStatement !== undefined) update.problem_statement = payload.problemStatement.trim().slice(0, 4000) || null;
  if (payload.intendedOutcome !== undefined) update.intended_outcome = payload.intendedOutcome.trim().slice(0, 4000) || null;
  if (payload.scopeConstraints !== undefined) update.scope_constraints = payload.scopeConstraints.trim().slice(0, 4000) || null;
  if (payload.acceptanceCriteria !== undefined) update.acceptance_criteria = payload.acceptanceCriteria.trim().slice(0, 6000) || null;
  if (payload.evidenceRequired !== undefined) update.evidence_required = payload.evidenceRequired.trim().slice(0, 4000) || null;
  if (payload.definitionOfDone !== undefined) update.definition_of_done = payload.definitionOfDone.trim().slice(0, 4000) || null;
  if (payload.evidenceLink !== undefined) update.evidence_link = payload.evidenceLink.trim().slice(0, 1000) || null;

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
    update.review_status = payload.reviewStatus;
    update.score_final = ["accepted", "partial", "changes_requested"].includes(payload.reviewStatus);
  }

  if (payload.scorePoints !== undefined) {
    update.score_points = Math.max(0, payload.scorePoints);
  }

  if (payload.scoreFinal !== undefined) {
    update.score_final = Boolean(payload.scoreFinal);
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

  if (Object.keys(update).length || payload.note !== undefined || payload.dependsOn !== undefined) {
    await supabase.from("task_activity").insert({
      task_id: id,
      message: "Aufgabe aktualisiert",
    });
  }

  if (currentTask && payload.reviewStatus === "requested" && currentTask.review_status !== "requested") {
    const { data: leads } = await supabase.from("profiles").select("id").in("platform_role", ["ceo", "deputy"]);
    const notifications = (leads || [])
      .filter((lead) => lead.id !== permission.profile?.id)
      .map((lead) => ({
        type: "task.review_requested",
        actor_profile_id: permission.profile?.id || null,
        recipient_profile_id: lead.id,
        entity_type: "task",
        entity_id: id,
        title: `Review angefragt: ${currentTask.title}`,
        body: "Founder hat die Aufgabe zur Review eingereicht.",
      }));
    if (notifications.length) {
      await supabase.from("notification_events").insert(notifications);
    }
  }

  return NextResponse.json({ ok: true });
}

