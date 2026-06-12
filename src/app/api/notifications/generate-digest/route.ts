import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { requireOperationalLead } from "@/lib/authz";
import { getServerSupabase } from "@/lib/supabase";

type TaskRow = {
  id: string;
  title: string;
  description: string | null;
  status: string | null;
  priority: string | null;
  owner: string | null;
  end_date: string | null;
  review_status: string | null;
  task_type: string | null;
  score_relevant: boolean | null;
  score_final: boolean | null;
};

type BlockerRow = {
  id: number;
  task_id: string;
  profile_id: string | null;
  reason: string;
  impact: string | null;
  status: string;
};

type DecisionRow = {
  id: number;
  title: string;
  context: string | null;
  required_profile_ids: string[] | null;
};

type ConfirmationRow = {
  decision_id: number;
  profile_id: string;
};

type SprintRow = {
  id: string;
  name: string;
  status: string;
  review_due_at: string | null;
};

type ReminderCandidate = {
  type: string;
  actorProfileId: string | null;
  recipientProfileId: string | null;
  entityType: string;
  entityId: string;
  title: string;
  body: string;
  dedupeKey: string;
};

const pipelineSecretHeader = "x-founderops-delivery-secret";
const groupRecipient = "space";

function safeLimit(value: unknown) {
  const limit = Number(value || 20);
  if (!Number.isFinite(limit)) return 20;
  return Math.max(1, Math.min(50, Math.round(limit)));
}

function secretsMatch(provided: string, expected: string) {
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  return providedBuffer.length === expectedBuffer.length && timingSafeEqual(providedBuffer, expectedBuffer);
}

async function authorizeDigestGeneration(request: NextRequest) {
  const providedSecret = request.headers.get(pipelineSecretHeader)?.trim() || "";
  if (providedSecret) {
    const expectedSecret = process.env.FOUNDEROPS_DELIVERY_SECRET?.trim() || "";
    if (!expectedSecret || !secretsMatch(providedSecret, expectedSecret)) {
      return { ok: false as const, status: 401, error: "Ungültiger Delivery-Secret." };
    }
    return { ok: true as const };
  }

  const permission = await requireOperationalLead(request);
  if (!permission.ok) return { ok: false as const, status: permission.status, error: permission.error };
  return { ok: true as const };
}

function berlinDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function isDueTodayOrOverdue(value: string | null, today: string) {
  if (!value) return false;
  return value.slice(0, 10) <= today;
}

function isDoneTask(task: TaskRow) {
  const status = (task.status || "").toLowerCase();
  return status.includes("erledigt") || Boolean(task.score_final);
}

function dedupeKey(type: string, entityType: string, entityId: string, dateKey: string, recipient = groupRecipient) {
  return `${type}:${entityType}:${entityId}:${recipient}:${dateKey}`;
}

function taskBody(task: TaskRow, fallback: string) {
  const owner = task.owner ? `Owner: ${task.owner}. ` : "";
  const priority = task.priority ? `Priorität: ${task.priority}. ` : "";
  return `${owner}${priority}${task.description || fallback}`.slice(0, 700);
}

export async function POST(request: NextRequest) {
  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: "Supabase env is not configured." }, { status: 501 });

  const permission = await authorizeDigestGeneration(request);
  if (!permission.ok) return NextResponse.json({ error: permission.error }, { status: permission.status });

  const payload = (await request.json().catch(() => ({}))) as { limit?: number; dryRun?: boolean };
  const limit = safeLimit(payload.limit);
  const dryRun = Boolean(payload.dryRun);
  const today = berlinDateKey();

  const [
    taskResult,
    blockerResult,
    decisionResult,
    confirmationResult,
    sprintResult,
  ] = await Promise.all([
    supabase
      .from("tasks")
      .select("id,title,description,status,priority,owner,end_date,review_status,task_type,score_relevant,score_final")
      .order("updated_at", { ascending: false })
      .limit(200),
    supabase
      .from("task_blockers")
      .select("id,task_id,profile_id,reason,impact,status")
      .eq("status", "open")
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("decision_log")
      .select("id,title,context,required_profile_ids")
      .eq("status", "open_for_confirmation")
      .order("updated_at", { ascending: false })
      .limit(50),
    supabase
      .from("decision_confirmations")
      .select("decision_id,profile_id")
      .limit(500),
    supabase
      .from("sprints")
      .select("id,name,status,review_due_at")
      .in("status", ["active", "review"])
      .order("review_due_at", { ascending: true })
      .limit(20),
  ]);

  const firstError = [taskResult, blockerResult, decisionResult, confirmationResult, sprintResult].find((result) => result.error)?.error;
  if (firstError) return NextResponse.json({ error: firstError.message }, { status: 500 });

  const tasks = (taskResult.data || []) as TaskRow[];
  const tasksById = new Map(tasks.map((task) => [task.id, task]));
  const confirmations = (confirmationResult.data || []) as ConfirmationRow[];
  const confirmedByDecision = new Map<number, Set<string>>();
  for (const confirmation of confirmations) {
    confirmedByDecision.set(confirmation.decision_id, new Set([...(confirmedByDecision.get(confirmation.decision_id) || []), confirmation.profile_id]));
  }

  const candidates: ReminderCandidate[] = [];
  for (const task of tasks) {
    if (isDoneTask(task)) continue;

    if (task.review_status === "requested") {
      candidates.push({
        type: "task.review_requested",
        actorProfileId: task.owner,
        recipientProfileId: null,
        entityType: "task",
        entityId: task.id,
        title: `Review offen: ${task.title}`,
        body: taskBody(task, "Dieses Deliverable wartet auf Review."),
        dedupeKey: dedupeKey("task.review_requested", "task", task.id, today),
      });
    }

    if (task.review_status === "changes_requested" || task.status === "Nacharbeit") {
      candidates.push({
        type: "task.review_rework",
        actorProfileId: task.owner,
        recipientProfileId: null,
        entityType: "task",
        entityId: task.id,
        title: `Nacharbeit offen: ${task.title}`,
        body: taskBody(task, "Für dieses Deliverable ist Nacharbeit offen."),
        dedupeKey: dedupeKey("task.review_rework", "task", task.id, today),
      });
    }

    if (task.task_type === "proposal" || task.status === "Vorschlag") {
      candidates.push({
        type: "task.proposed",
        actorProfileId: task.owner,
        recipientProfileId: null,
        entityType: "task",
        entityId: task.id,
        title: `Aufgabenvorschlag offen: ${task.title}`,
        body: taskBody(task, "Dieser Aufgabenvorschlag braucht Entscheidung oder Einordnung."),
        dedupeKey: dedupeKey("task.proposed", "task", task.id, today),
      });
    }

    if (task.task_type === "deliverable" && isDueTodayOrOverdue(task.end_date, today)) {
      candidates.push({
        type: "task.deadline_overdue",
        actorProfileId: task.owner,
        recipientProfileId: null,
        entityType: "task",
        entityId: task.id,
        title: `Überfällig: ${task.title}`,
        body: taskBody(task, `Zieltermin war ${task.end_date}. Bitte Status, Review oder Blocker klären.`),
        dedupeKey: dedupeKey("task.deadline_overdue", "task", task.id, today),
      });
    }
  }

  for (const blocker of (blockerResult.data || []) as BlockerRow[]) {
    const task = tasksById.get(blocker.task_id);
    candidates.push({
      type: "task.blocker_reported",
      actorProfileId: blocker.profile_id,
      recipientProfileId: null,
      entityType: "task",
      entityId: blocker.task_id,
      title: `Blocker offen: ${task?.title || blocker.task_id}`,
      body: `${blocker.reason}${blocker.impact ? ` Impact: ${blocker.impact}` : ""}`.slice(0, 700),
      dedupeKey: dedupeKey("task.blocker_reported", "task", blocker.task_id, today),
    });
  }

  for (const decision of (decisionResult.data || []) as DecisionRow[]) {
    const required = decision.required_profile_ids || [];
    const confirmed = confirmedByDecision.get(decision.id) || new Set<string>();
    const missing = required.filter((profileId) => !confirmed.has(profileId));
    if (!required.length || missing.length) {
      candidates.push({
        type: "decision.confirmation_requested",
        actorProfileId: null,
        recipientProfileId: null,
        entityType: "decision",
        entityId: String(decision.id),
        title: `Decision wartet auf Bestätigung: ${decision.title}`,
        body: decision.context || "Diese Decision ist offen für Bestätigung.",
        dedupeKey: dedupeKey("decision.confirmation_requested", "decision", String(decision.id), today),
      });
    }
  }

  for (const sprint of (sprintResult.data || []) as SprintRow[]) {
    if (!isDueTodayOrOverdue(sprint.review_due_at, today)) continue;
    candidates.push({
      type: "sprint.review_due",
      actorProfileId: null,
      recipientProfileId: null,
      entityType: "sprint",
      entityId: sprint.id,
      title: `Sprint-Review fällig: ${sprint.name}`,
      body: sprint.review_due_at ? `Review-Frist: ${sprint.review_due_at.slice(0, 10)}.` : "Sprint-Review ist fällig.",
      dedupeKey: dedupeKey("sprint.review_due", "sprint", sprint.id, today),
    });
  }

  const limitedCandidates = candidates.slice(0, limit);
  const candidateKeys = limitedCandidates.map((candidate) => candidate.dedupeKey);
  const existingResult = candidateKeys.length
    ? await supabase.from("notification_events").select("dedupe_key").in("dedupe_key", candidateKeys)
    : { data: [] };

  if ("error" in existingResult && existingResult.error) {
    return NextResponse.json({ error: existingResult.error.message }, { status: 500 });
  }

  const existingKeys = new Set((existingResult.data || []).map((row: { dedupe_key: string | null }) => row.dedupe_key).filter(Boolean));
  const toCreate = limitedCandidates.filter((candidate) => !existingKeys.has(candidate.dedupeKey));

  if (!dryRun && toCreate.length) {
    const insertResult = await supabase.from("notification_events").insert(toCreate.map((candidate) => ({
      type: candidate.type,
      actor_profile_id: candidate.actorProfileId,
      recipient_profile_id: candidate.recipientProfileId,
      entity_type: candidate.entityType,
      entity_id: candidate.entityId,
      title: candidate.title,
      body: candidate.body,
      dedupe_key: candidate.dedupeKey,
    })));
    if (insertResult.error) return NextResponse.json({ error: insertResult.error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    dryRun,
    dateKey: today,
    checked: candidates.length,
    considered: limitedCandidates.length,
    created: dryRun ? 0 : toCreate.length,
    skippedDedupe: limitedCandidates.length - toCreate.length,
    candidates: dryRun ? limitedCandidates.map((candidate) => ({
      type: candidate.type,
      entityType: candidate.entityType,
      entityId: candidate.entityId,
      title: candidate.title,
      dedupeKey: candidate.dedupeKey,
    })) : [],
  });
}
