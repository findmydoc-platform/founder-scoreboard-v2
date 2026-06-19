import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { requireOperationalLead } from "@/lib/authz";
import { getServerSupabase } from "@/lib/supabase";
import { apiError, authzError, supabaseUnavailable } from "@/lib/api-response";

type TaskRow = {
  id: string;
  title: string;
  description: string | null;
  status: string | null;
  priority: string | null;
  owner: string | null;
  end_date: string | null;
  review_status: string | null;
  review_owner_profile_id: string | null;
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

type FounderEventRow = {
  id: number;
  title: string;
  category: string;
  starts_at: string;
  ends_at: string | null;
  location: string | null;
  description: string | null;
  audience_mode: "all" | "selected";
  participant_profile_ids: string[] | null;
  reminder_days_before: number;
  reminder_generated_at: string | null;
  status: string;
};

type ProfileRow = {
  id: string;
  platform_role: string | null;
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

function isReminderWindowReached(event: FounderEventRow, now: Date) {
  if (event.status !== "planned" || event.reminder_generated_at) return false;
  const startsAt = new Date(event.starts_at);
  if (Number.isNaN(startsAt.getTime())) return false;
  const reminderAt = new Date(startsAt);
  reminderAt.setDate(reminderAt.getDate() - event.reminder_days_before);
  return reminderAt.getTime() <= now.getTime() && startsAt.getTime() >= now.getTime();
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

function eventBody(event: FounderEventRow) {
  const startsAt = new Intl.DateTimeFormat("de-DE", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Berlin",
  }).format(new Date(event.starts_at));
  const location = event.location ? ` Ort: ${event.location}.` : "";
  const description = event.description ? ` ${event.description}` : "";
  return `Start: ${startsAt}.${location}${description}`.slice(0, 700);
}

export async function POST(request: NextRequest) {
  const supabase = getServerSupabase();
  if (!supabase) return supabaseUnavailable();

  const permission = await authorizeDigestGeneration(request);
  if (!permission.ok) return authzError(permission);

  const payload = (await request.json().catch(() => ({}))) as { limit?: number; dryRun?: boolean };
  const limit = safeLimit(payload.limit);
  const dryRun = Boolean(payload.dryRun);
  const today = berlinDateKey();
  const now = new Date();

  const [
    taskResult,
    blockerResult,
    decisionResult,
    confirmationResult,
    sprintResult,
    eventResult,
    profileResult,
  ] = await Promise.all([
    supabase
      .from("tasks")
      .select("id,title,description,status,priority,owner,end_date,review_status,review_owner_profile_id,task_type,score_relevant,score_final")
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
    supabase
      .from("founder_events")
      .select("id,title,category,starts_at,ends_at,location,description,audience_mode,participant_profile_ids,reminder_days_before,reminder_generated_at,status")
      .eq("status", "planned")
      .is("reminder_generated_at", null)
      .order("starts_at", { ascending: true })
      .limit(100),
    supabase
      .from("profiles")
      .select("id,platform_role")
      .neq("platform_role", "viewer")
      .limit(100),
  ]);

  const firstError = [taskResult, blockerResult, decisionResult, confirmationResult, sprintResult, eventResult, profileResult].find((result) => result.error)?.error;
  if (firstError) return apiError(firstError.message, 500);

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
      const reviewOwnerProfileId = task.review_owner_profile_id || null;
      candidates.push({
        type: "task.review_requested",
        actorProfileId: task.owner,
        recipientProfileId: reviewOwnerProfileId,
        entityType: "task",
        entityId: task.id,
        title: `Review offen: ${task.title}`,
        body: taskBody(task, reviewOwnerProfileId ? "Dieses Deliverable wartet auf deine Accountable-Review." : "Dieses Deliverable wartet auf Review, hat aber keinen Review Owner."),
        dedupeKey: dedupeKey("task.review_requested", "task", task.id, today, reviewOwnerProfileId || groupRecipient),
      });
    }

    if (task.review_status === "changes_requested" || task.status === "Nacharbeit") {
      candidates.push({
        type: "task.review_rework",
        actorProfileId: task.owner,
        recipientProfileId: task.owner,
        entityType: "task",
        entityId: task.id,
        title: `Nacharbeit offen: ${task.title}`,
        body: taskBody(task, "Für dieses Deliverable ist Nacharbeit offen."),
        dedupeKey: dedupeKey("task.review_rework", "task", task.id, today, task.owner || groupRecipient),
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
        recipientProfileId: task.owner,
        entityType: "task",
        entityId: task.id,
        title: `Überfällig: ${task.title}`,
        body: taskBody(task, `Zieltermin war ${task.end_date}. Bitte Status, Review oder Blocker klären.`),
        dedupeKey: dedupeKey("task.deadline_overdue", "task", task.id, today, task.owner || groupRecipient),
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
    if (!required.length) {
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
    for (const profileId of missing) {
      candidates.push({
        type: "decision.confirmation_requested",
        actorProfileId: null,
        recipientProfileId: profileId,
        entityType: "decision",
        entityId: String(decision.id),
        title: `Decision wartet auf Bestätigung: ${decision.title}`,
        body: decision.context || "Diese Decision ist offen für Bestätigung.",
        dedupeKey: dedupeKey("decision.confirmation_requested", "decision", String(decision.id), today, profileId),
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

  const activeProfileIds = ((profileResult.data || []) as ProfileRow[]).map((profile) => profile.id);
  for (const event of (eventResult.data || []) as FounderEventRow[]) {
    if (!isReminderWindowReached(event, now)) continue;
    const recipientProfileIds = event.audience_mode === "selected"
      ? (event.participant_profile_ids || []).filter(Boolean)
      : activeProfileIds;
    if (!recipientProfileIds.length) continue;
    for (const profileId of recipientProfileIds) {
      candidates.push({
        type: "event.upcoming",
        actorProfileId: null,
        recipientProfileId: profileId,
        entityType: "founder_event",
        entityId: String(event.id),
        title: `Event steht bald an: ${event.title}`,
        body: eventBody(event),
        dedupeKey: dedupeKey("event.upcoming", "founder_event", String(event.id), today, profileId),
      });
    }
  }

  const limitedCandidates = candidates.slice(0, limit);
  const candidateKeys = limitedCandidates.map((candidate) => candidate.dedupeKey);
  const existingResult = candidateKeys.length
    ? await supabase.from("notification_events").select("dedupe_key").in("dedupe_key", candidateKeys)
    : { data: [] };

  if ("error" in existingResult && existingResult.error) {
    return apiError(existingResult.error.message, 500);
  }

  const existingKeys = new Set((existingResult.data || []).map((row: { dedupe_key: string | null }) => row.dedupe_key).filter(Boolean));
  const toCreate = limitedCandidates.filter((candidate) => !existingKeys.has(candidate.dedupeKey));
  const generatedReminderEventIds = new Set(
    toCreate
      .filter((candidate) => candidate.type === "event.upcoming" && candidate.entityType === "founder_event")
      .map((candidate) => Number(candidate.entityId))
      .filter((id) => Number.isFinite(id)),
  );

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
    if (insertResult.error) return apiError(insertResult.error.message, 500);
  }

  if (!dryRun && generatedReminderEventIds.size) {
    const updateResult = await supabase
      .from("founder_events")
      .update({ reminder_generated_at: now.toISOString(), updated_at: now.toISOString() })
      .in("id", [...generatedReminderEventIds]);
    if (updateResult.error) return apiError(updateResult.error.message, 500);
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
