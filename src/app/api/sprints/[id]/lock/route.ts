import { NextResponse, type NextRequest } from "next/server";
import { requireOperationalLead } from "@/lib/authz";
import { getServerSupabase } from "@/lib/supabase";

type TaskRow = {
  id: string;
  project_id: string;
  package_id: string | null;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  owner: string | null;
  assignee: string | null;
  workstream: string | null;
  sort_order: number;
  start_date: string | null;
  end_date: string | null;
  deadline: string | null;
  estimate_hours: number | null;
  definition_of_done: string | null;
  evidence_link: string | null;
  issue_number: string | null;
  issue_url: string | null;
  sprint_id: string | null;
  review_status: string | null;
  score_points: number | null;
  score_final: boolean | null;
  task_type: string | null;
  score_relevant: boolean | null;
  carryover_count: number | null;
  original_sprint_id: string | null;
};

function normalizeStatus(value: string) {
  return value.trim().toLowerCase();
}

function sprintOutcome(task: TaskRow, hasOpenBlocker: boolean) {
  if (task.review_status === "partial") return "partial";
  if (task.review_status === "changes_requested" || normalizeStatus(task.status).includes("nacharbeit")) return "rework";
  if (hasOpenBlocker || normalizeStatus(task.status).includes("block")) return "communicated_blocker";
  if (task.review_status === "requested" || normalizeStatus(task.status).includes("review")) return "missed_no_review";
  return "missed_uncommunicated";
}

function carryoverReason(outcome: string) {
  const reasons: Record<string, string> = {
    partial: "Teilweise akzeptiert, Restarbeit wird in den nächsten Sprint übertragen.",
    rework: "Nacharbeit aus Review wird in den nächsten Sprint übertragen.",
    communicated_blocker: "Blocker wurde kommuniziert; Deliverable wird planbar übertragen.",
    missed_no_review: "Review war offen oder nicht abgeschlossen; Deliverable wird übertragen.",
    missed_uncommunicated: "Deliverable wurde nicht rechtzeitig finalisiert oder kommuniziert.",
  };
  return reasons[outcome] || "Deliverable wurde in den nächsten Sprint übertragen.";
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: "Supabase env is not configured." }, { status: 501 });

  const permission = await requireOperationalLead(request);
  if (!permission.ok) return NextResponse.json({ error: permission.error }, { status: permission.status });

  const { id } = await context.params;

  const { data: sprint, error: sprintError } = await supabase
    .from("sprints")
    .select("id,name,start_date,end_date,score_locked")
    .eq("id", id)
    .single();

  if (sprintError || !sprint) return NextResponse.json({ error: "Sprint wurde nicht gefunden." }, { status: 404 });
  if (sprint.score_locked) return NextResponse.json({ error: "Sprint ist bereits gelockt." }, { status: 409 });

  const { data: nextSprint } = await supabase
    .from("sprints")
    .select("id,name")
    .neq("id", id)
    .gt("start_date", sprint.start_date || "1900-01-01")
    .order("start_date", { ascending: true })
    .limit(1)
    .maybeSingle();

  const { data: tasks, error: tasksError } = await supabase
    .from("tasks")
    .select("id,project_id,package_id,title,description,status,priority,owner,assignee,workstream,sort_order,start_date,end_date,deadline,estimate_hours,definition_of_done,evidence_link,issue_number,issue_url,sprint_id,review_status,score_points,score_final,task_type,score_relevant,carryover_count,original_sprint_id")
    .eq("sprint_id", id);

  if (tasksError) return NextResponse.json({ error: tasksError.message }, { status: 500 });

  const sprintTasks = (tasks || []) as TaskRow[];
  const openTasks = sprintTasks.filter((task) =>
    task.task_type !== "sub_issue"
    && task.score_relevant !== false
    && !task.score_final
  );
  const taskIds = openTasks.map((task) => task.id);

  const blockerResult = taskIds.length
    ? await supabase.from("task_blockers").select("id,task_id,status").in("task_id", taskIds).eq("status", "open")
    : { data: [] };
  const openBlockerTaskIds = new Set((blockerResult.data || []).map((blocker: { task_id: string }) => blocker.task_id));

  const carryoverInserts = [];
  const notifications = [];
  const nowSuffix = Date.now().toString(36);

  for (const task of openTasks) {
    const outcome = sprintOutcome(task, openBlockerTaskIds.has(task.id));
    const reason = carryoverReason(outcome);

    await supabase
      .from("tasks")
      .update({
        score_points: 0,
        score_final: true,
        sprint_outcome: outcome,
        carryover_reason: reason,
      })
      .eq("id", task.id);

    if (outcome === "communicated_blocker") {
      await supabase.from("task_blockers").update({ status: "accepted_carryover" }).eq("task_id", task.id).eq("status", "open");
    }

    if (nextSprint?.id) {
      carryoverInserts.push({
        id: `${task.id}-carryover-${nowSuffix}`,
        project_id: task.project_id,
        package_id: task.package_id,
        title: task.title,
        description: task.description,
        status: outcome === "communicated_blocker" ? "Blockiert" : "Offen",
        priority: task.priority,
        owner: task.owner,
        assignee: task.assignee,
        workstream: task.workstream,
        sort_order: task.sort_order + 10000,
        start_date: null,
        end_date: null,
        deadline: nextSprint.id,
        estimate_hours: task.estimate_hours,
        definition_of_done: task.definition_of_done,
        evidence_link: task.evidence_link,
        issue_number: task.issue_number,
        issue_url: task.issue_url,
        sprint_id: nextSprint.id,
        review_status: "not_requested",
        score_points: 0,
        score_final: false,
        github_repo: "findmydoc-platform/management",
        github_sync_status: "not_synced",
        task_type: "deliverable",
        score_relevant: true,
        original_sprint_id: task.original_sprint_id || id,
        carried_from_task_id: task.id,
        carried_from_sprint_id: id,
        carryover_reason: reason,
        carryover_count: Number(task.carryover_count || 0) + 1,
      });

      if (task.owner) {
        notifications.push({
          type: "sprint.task_carried_over",
          actor_profile_id: permission.profile?.id || null,
          recipient_profile_id: task.owner,
          entity_type: "task",
          entity_id: task.id,
          title: `Carry-over: ${task.title}`,
          body: `${reason}\nNeuer Sprint: ${nextSprint.name || nextSprint.id}`,
        });
      }
    }
  }

  if (carryoverInserts.length) {
    const { error: carryoverError } = await supabase.from("tasks").insert(carryoverInserts);
    if (carryoverError) return NextResponse.json({ error: carryoverError.message }, { status: 500 });
  }

  if (notifications.length) {
    await supabase.from("notification_events").insert(notifications);
  }

  const { error: freezeError } = await supabase
    .from("tasks")
    .update({ score_points: 0, score_final: true, sprint_outcome: "missed_uncommunicated" })
    .eq("sprint_id", id)
    .eq("score_final", false);

  if (freezeError) return NextResponse.json({ error: freezeError.message }, { status: 500 });

  const { error: updateError } = await supabase
    .from("sprints")
    .update({ score_locked: true, status: "closed", updated_at: new Date().toISOString() })
    .eq("id", id);

  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

  await supabase.from("audit_log").insert({
    actor_profile_id: permission.profile?.id || null,
    action: "sprint.lock_score",
    entity_type: "sprint",
    entity_id: id,
    after_data: {
      scoreLocked: true,
      status: "closed",
      openTasks: openTasks.length,
      carryoverCreated: carryoverInserts.length,
      nextSprintId: nextSprint?.id || null,
    },
    request_ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null,
    user_agent: request.headers.get("user-agent"),
  });

  return NextResponse.json({
    ok: true,
    sprint: { id, status: "closed", scoreLocked: true },
    carryover: {
      nextSprintId: nextSprint?.id || "",
      created: carryoverInserts.length,
      evaluated: openTasks.length,
    },
  });
}
