import "server-only";
import { authorizeDeliveryAdmission, deliveryStore, DeliveryAdmissionDenied } from "./delivery-admission";
import type { NotificationDigestInput } from "../notification-delivery-types";
import { deliveryLimit } from "./notification-delivery";
import { ACTIVE_TASKS_TABLE } from "../../planning-read-model";
import { createNotificationPayload, type NotificationType } from "../../notification-catalog";
type Candidate = {
  type: NotificationType;
  actorProfileId: string | null;
  recipientProfileId: string | null;
  entityType: string;
  entityId: string;
  title: string;
  body: string;
  dedupeKey: string;
};
export async function authorizeNotificationDigest(input: NotificationDigestInput) {
  const limit = deliveryLimit(input.limit), dryRun = input.dryRun === true;
  const admission = await authorizeDeliveryAdmission(input.credential.request, "notifications.digest.generate");
  if (!admission.ok)
    return admission;
  const data = deliveryStore(admission);
  let sourceIds: Record<string, Set<string>> | undefined;
  let profiles = new Set<string>();
  let keys: Set<string> | undefined;
  let insertedEventIds = new Set<number>();
  let insertionStarted = false;
  const denied = () => { throw new DeliveryAdmissionDenied({ ok: false, status: 403, error: "Erinnerung gehört nicht zum angenommenen Auftrag." }); };
  return { ok: true as const, digest: Object.freeze({
      async sources() {
        const results = await Promise.all([
          data.from(ACTIVE_TASKS_TABLE).select("id,title,description,status,priority,assignee,owner,fixed_date,review_status,review_owner_profile_id,task_type,approval_status,score_relevant,score_final").order("updated_at", { ascending: false }).limit(200),
          data.from("task_blockers").select("id,task_id,profile_id,reason,impact,status").eq("status", "open").order("created_at", { ascending: false }).limit(100),
          data.from("sprints").select("id,name,status,review_due_at").in("status", ["active", "review"]).order("review_due_at", { ascending: true }).limit(20),
          data.from("founder_events").select("id,title,category,starts_at,ends_at,location,description,audience_mode,participant_profile_ids,reminder_days_before,reminder_generated_at,status").eq("status", "planned").is("reminder_generated_at", null).order("starts_at", { ascending: true }).limit(100),
          data.from("profiles").select("id,platform_role").neq("platform_role", "viewer").limit(100),
        ] as const);
        if (results.some(result => result.error)) {
          const assert = await admission.reassert();
          assert();
        }
        sourceIds = { task: new Set((results[0].data || []).map(row => String(row.id))), sprint: new Set((results[2].data || []).map(row => String(row.id))), founder_event: new Set((results[3].data || []).map(row => String(row.id))) };
        profiles = new Set([
          ...(results[4].data || []).map(row => String(row.id)),
          ...(results[0].data || []).flatMap(row => [row.assignee, row.owner, row.review_owner_profile_id]).filter((id): id is string => Boolean(id)),
          ...(results[3].data || []).flatMap(row => row.participant_profile_ids || []),
        ]);
        return results;
      },
      async existing(candidateKeys: readonly string[]) {
        const selected = [...candidateKeys];
        if (!sourceIds || selected.length > limit || keys)
          denied();
        keys = new Set(selected);
        const result = selected.length ? await data.from("notification_events").select("dedupe_key").in("dedupe_key", selected) : { data: [], error: null };
        if (result.error) {
          const assert = await admission.reassert();
          assert();
        }
        return result;
      },
      async create(candidates: readonly Candidate[]) {
        const selected = structuredClone(candidates);
        if (dryRun || insertionStarted || !sourceIds || !keys || selected.length > limit)
          denied();
        for (const row of selected)
          if (!["task.review_requested", "task.review_rework", "task.proposed", "task.deadline_overdue", "task.blocker_reported", "sprint.review_due", "event.upcoming"].includes(row.type) || !keys!.has(row.dedupeKey) || !sourceIds![row.entityType]?.has(row.entityId) || (row.recipientProfileId && !profiles.has(row.recipientProfileId)))
            denied();
        insertionStarted = true;
        const result = await data.from("notification_events").insert(selected.map(candidate => createNotificationPayload(candidate.type, candidate)));
        if (result.error) {
          const assert = await admission.reassert();
          assert();
        }
        if (!result.error)
          insertedEventIds = new Set(selected.filter(row => row.type === "event.upcoming" && row.entityType === "founder_event").map(row => Number(row.entityId)));
        return result;
      },
      async markReminders(now: string) {
        if (dryRun || !insertedEventIds.size)
          denied();
        const ids = [...insertedEventIds];
        insertedEventIds = new Set();
        return await data.from("founder_events").update({ reminder_generated_at: now, updated_at: now }).in("id", ids);
      },
    }) };
}
