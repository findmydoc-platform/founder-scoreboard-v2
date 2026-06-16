import { NextResponse, type NextRequest } from "next/server";
import { auditRequestMetadata, cleanText } from "@/lib/api-input";
import { requireFounder } from "@/lib/authz";
import { isOperationalLeadRole } from "@/lib/platform";
import { getServerSupabase } from "@/lib/supabase";
import { taskStatuses } from "@/lib/status";
import type { Task, TaskType } from "@/lib/types";

type CreateTaskPayload = {
  title?: string;
  description?: string;
  problemStatement?: string;
  intendedOutcome?: string;
  scopeConstraints?: string;
  acceptanceCriteria?: string;
  evidenceRequired?: string;
  taskType?: TaskType;
  parentTaskId?: string;
  packageId?: string;
  milestoneId?: string;
  sprintId?: string;
  owner?: string;
  priority?: string;
  status?: string;
  workstream?: string;
  startDate?: string;
  endDate?: string;
  deadline?: string;
  hours?: number;
  definitionOfDone?: string;
};

const taskTypes = new Set(["deliverable", "proposal", "sub_issue"]);
const priorities = new Set(["P0", "P1", "P2", "P3", "P4"]);

function slugify(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70);
}

function profileId(value?: string) {
  return slugify(value || "");
}

export async function POST(request: NextRequest) {
  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: "Supabase env is not configured." }, { status: 501 });

  const permission = await requireFounder(request);
  if (!permission.ok) return NextResponse.json({ error: permission.error }, { status: permission.status });

  const payload = (await request.json()) as CreateTaskPayload;
  const title = cleanText(payload.title, 240);
  if (title.length < 3) return NextResponse.json({ error: "Titel ist erforderlich." }, { status: 400 });

  const requestedType = payload.taskType || "deliverable";
  if (!taskTypes.has(requestedType)) return NextResponse.json({ error: "Ungültiger Aufgabentyp." }, { status: 400 });

  const isOperationalLead = isOperationalLeadRole(permission.profile?.platformRole);
  const packageId = payload.packageId || null;
  let milestoneId = payload.milestoneId || null;
  let initiative: { id: string; milestone_id: string | null; owner_id?: string | null; accountable_profile_id?: string | null } | null = null;
  const startDate = payload.startDate || null;
  const endDate = payload.endDate || null;

  if (startDate && endDate && startDate > endDate) {
    return NextResponse.json({ error: "Das Startdatum darf nicht nach dem Enddatum liegen." }, { status: 400 });
  }

  if (packageId) {
    const { data: initiativeRow, error: initiativeError } = await supabase
      .from("packages")
      .select("id,milestone_id,owner_id,accountable_profile_id")
      .eq("id", packageId)
      .maybeSingle();
    if (initiativeError || !initiativeRow) {
      return NextResponse.json({ error: "Initiative wurde nicht gefunden." }, { status: 404 });
    }
    initiative = initiativeRow;
    milestoneId = milestoneId || initiative.milestone_id || null;
  }


  const canCreateDeliverable = isOperationalLead || (requestedType === "deliverable" && initiative?.owner_id === permission.profile?.id);
  const taskType: TaskType = requestedType === "deliverable" && !canCreateDeliverable ? "proposal" : requestedType;
  const scoreRelevant = taskType === "deliverable";
  const status = taskType === "proposal" ? "Vorschlag" : payload.status && taskStatuses.includes(payload.status as (typeof taskStatuses)[number]) ? payload.status : "Offen";
  const priority = payload.priority && priorities.has(payload.priority) ? payload.priority : "P2";
  const owner = profileId(payload.owner) || (taskType === "proposal" ? null : permission.profile?.id || null);
  const reviewOwnerProfileId = packageId ? initiative?.accountable_profile_id || initiative?.owner_id || null : null;
  const parentTaskId = taskType === "sub_issue" ? payload.parentTaskId || "" : "";

  if (taskType === "deliverable" && (!packageId || !payload.sprintId)) {
    return NextResponse.json({ error: "Deliverables brauchen Initiative und Sprint." }, { status: 400 });
  }

  if (taskType === "sub_issue" && !parentTaskId) {
    return NextResponse.json({ error: "Sub-Issue braucht ein Deliverable." }, { status: 400 });
  }

  if (taskType === "sub_issue") {
    const { data: parent, error: parentError } = await supabase
      .from("tasks")
      .select("id,owner,title")
      .eq("id", parentTaskId)
      .single();
    if (parentError || !parent) return NextResponse.json({ error: "Deliverable wurde nicht gefunden." }, { status: 404 });
    if (!isOperationalLead && parent.owner !== permission.profile?.id) {
      return NextResponse.json({ error: "Founder können nur eigene Deliverables verfeinern." }, { status: 403 });
    }
  }

  const { data: maxRow } = await supabase
    .from("tasks")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const idBase = `${permission.profile?.id || "task"}-${slugify(title) || "neue-aufgabe"}`;
  const id = `${idBase}-${Date.now().toString(36)}`;
  const sortOrder = Number(maxRow?.sort_order || 0) + 1;

  const insert = {
    id,
    project_id: "findmydoc-founder-execution",
    package_id: packageId,
    milestone_id: milestoneId,
    title,
    description: cleanText(payload.description, 4000),
    problem_statement: cleanText(payload.problemStatement, 4000),
    intended_outcome: cleanText(payload.intendedOutcome, 4000),
    scope_constraints: cleanText(payload.scopeConstraints, 4000),
    acceptance_criteria: cleanText(payload.acceptanceCriteria, 6000),
    evidence_required: cleanText(payload.evidenceRequired, 4000),
    dod_template_version: "founder-deliverable-v2",
    status,
    priority,
    owner,
    assignee: owner,
    created_by: permission.profile?.id || null,
    workstream: cleanText(payload.workstream, 120),
    sort_order: sortOrder,
    start_date: startDate,
    end_date: endDate,
    deadline: payload.deadline || null,
    estimate_hours: Math.max(0, Math.min(200, Math.round(Number(payload.hours || 0)))),
    definition_of_done: cleanText(payload.definitionOfDone, 4000),
    sprint_id: taskType === "proposal" || taskType === "sub_issue" ? null : payload.sprintId || null,
    review_status: "not_requested",
    review_owner_profile_id: reviewOwnerProfileId,
    score_points: 0,
    score_final: false,
    github_repo: "findmydoc-platform/management",
    github_sync_status: "not_synced",
    task_type: taskType,
    parent_task_id: parentTaskId || null,
    score_relevant: scoreRelevant,
  };

  const { data: created, error: insertError } = await supabase.from("tasks").insert(insert).select("*").single();
  if (insertError || !created) return NextResponse.json({ error: insertError?.message || "Aufgabe konnte nicht erstellt werden." }, { status: 500 });

  const profileIds = [...new Set([created.owner, created.assignee, created.created_by].filter((value): value is string => typeof value === "string" && Boolean(value)))];
  const { data: profileRows } = profileIds.length
    ? await supabase.from("profiles").select("id,name").in("id", profileIds)
    : { data: [] };
  const profileNameById = new Map((profileRows || []).map((profile: { id: string; name: string }) => [profile.id, profile.name]));

  await supabase.from("task_activity").insert({
    task_id: id,
    message: taskType === "proposal" ? "Aufgabenvorschlag erstellt" : taskType === "sub_issue" ? "Sub-Issue erstellt" : "Deliverable erstellt",
  });

  if (taskType === "proposal") {
    const { data: leads } = await supabase.from("profiles").select("id").in("platform_role", ["ceo", "deputy"]);
    const notifications = (leads || [])
      .filter((lead) => lead.id !== permission.profile?.id)
      .map((lead) => ({
        type: "task.proposed",
        actor_profile_id: permission.profile?.id || null,
        recipient_profile_id: lead.id,
        entity_type: "task",
        entity_id: id,
        title: `Aufgabenvorschlag: ${title}`,
        body: insert.description || "Founder hat eine neue Aufgabe vorgeschlagen.",
      }));
    if (notifications.length) await supabase.from("notification_events").insert(notifications);
  }

  await supabase.from("audit_log").insert({
    actor_profile_id: permission.profile?.id || null,
    action: "task.create",
    entity_type: "task",
    entity_id: id,
    after_data: { ...insert },
    ...auditRequestMetadata(request),
  });

  const task: Task = {
    id: created.id,
    order: created.sort_order,
    title: created.title,
    description: created.description || "",
    status: created.status,
    priority: created.priority,
    ownerId: created.owner || "",
    owner: profileNameById.get(created.owner || "") || created.owner || "",
    assigneeId: created.assignee || "",
    assignee: profileNameById.get(created.assignee || "") || created.assignee || "",
    createdById: created.created_by || "",
    createdBy: profileNameById.get(created.created_by || "") || created.created_by || "",
    workstream: created.workstream || "",
    packageId: created.package_id || "",
    deadline: created.deadline || "",
    problemStatement: created.problem_statement || "",
    intendedOutcome: created.intended_outcome || "",
    scopeConstraints: created.scope_constraints || "",
    acceptanceCriteria: created.acceptance_criteria || "",
    evidenceRequired: created.evidence_required || "",
    dodTemplateVersion: created.dod_template_version || "founder-deliverable-v2",
    definitionOfDone: created.definition_of_done || "",
    dependsOn: "",
    evidenceLink: created.evidence_link || "",
    issueNumber: created.issue_number || "",
    issueUrl: created.issue_url || "",
    note: "",
    watched: Boolean(created.watched),
    hours: created.estimate_hours || 0,
    startDate: created.start_date || "",
    endDate: created.end_date || "",
    sprintId: created.sprint_id || "",
    milestoneId: created.milestone_id || "",
    reviewStatus: created.review_status || "not_requested",
    reviewOwnerProfileId: created.review_owner_profile_id || "",
    reviewRequestedAt: created.review_requested_at || "",
    scorePoints: created.score_points || 0,
    scoreFinal: Boolean(created.score_final),
    githubRepo: created.github_repo || "findmydoc-platform/management",
    githubIssueNumber: created.github_issue_number,
    githubIssueUrl: created.github_issue_url || "",
    githubSyncStatus: created.github_sync_status || "not_synced",
    githubLastSyncedAt: created.github_last_synced_at || "",
    githubSyncError: created.github_sync_error || "",
    taskType: created.task_type || taskType,
    parentTaskId: created.parent_task_id || "",
    scoreRelevant: created.score_relevant !== false,
    selfDodChecked: Boolean(created.self_dod_checked),
    selfEvidenceChecked: Boolean(created.self_evidence_checked),
    selfDocumentedChecked: Boolean(created.self_documented_checked),
    selfBlockersChecked: Boolean(created.self_blockers_checked),
  };

  return NextResponse.json({ ok: true, task });
}
