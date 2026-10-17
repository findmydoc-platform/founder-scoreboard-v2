import "server-only";
import { authorizeDeliveryAdmission, deliveryStore, bookkeepingStore, DeliveryAdmissionDenied } from "./delivery-admission";
import { runWithDeliveryAdmission } from "./delivery-admission-scope";
import { authorizeGoogleChat } from "./google-chat";
import type { GoogleChatMessage } from "../google-chat-types";
import type { NotificationDeliveryInput, NotificationDeliveryRow, NotificationDeliveryProfile, NotificationDeliveryPreference, DeliveryRecordRow } from "../notification-delivery-types";
import { shouldSendToGoogleChatDm } from "../../notification-policy";
import { reconcileNotificationEvents } from "../../notification-resolution";
export function deliveryLimit(value: unknown) { const n = Number(value || 20); return Number.isFinite(n) ? Math.max(1, Math.min(50, Math.round(n))) : 20; }
function eventIds(value: unknown): number[] { return Array.isArray(value) ? [...new Set(value.map(Number).filter(n => Number.isInteger(n) && n > 0))].slice(0, 20) : []; }
function claimFailure(message = "Zustellauftrag ist nicht mehr exklusiv reserviert."): never { throw new DeliveryAdmissionDenied({ ok: false, status: 409, error: message }); }
export async function authorizeNotificationDelivery(input: NotificationDeliveryInput) {
  const action = input.action;
  const selection = action === "notifications.delivery.run" ? structuredClone(input.selection) : {};
  const selectedEventIds = eventIds(selection.eventIds);
  const limit = deliveryLimit(selection.limit);
  const permission = await authorizeDeliveryAdmission(input.credential.request, action);
  if (!permission.ok)
    return permission;
  const admission = permission;
  const data = deliveryStore(admission);
  const book = bookkeepingStore(admission);
  if (action === "notifications.delivery.inspect")
    return { ok: true as const, inspection: Object.freeze({ async pending() {
          const { count, error } = await data.from("notification_events").select("id", { count: "exact", head: true }).eq("status", "pending");
          if (error) {
            const assert = await admission.reassert();
            assert();
          }
          return { count: count || 0, error };
        } }) };
  let reservation: Promise<ReturnType<typeof reserve> extends Promise<infer T> ? T : never> | undefined;
  async function reserve() {
    const assert = await admission.reassert();
    assert();
    const claimData = admission.mode === "user" ? admission.claimData : data;
    if (!claimData)
      return { ok: false as const, status: 401, error: "Anmeldung erforderlich." };
    const { data: claim, error } = await claimData.rpc("claim_notification_delivery", { p_event_ids: selectedEventIds.length ? selectedEventIds : null,
      p_limit: limit, p_test_delivery: selection.testDelivery || null, p_recipient_profile_id: selection.profileId || null });
    if (error) {
      const current = await admission.reassert();
      current();
      if (error.code === "42501") {
        if (admission.mode === "user") {
          const result = await admission.reassert();
          result();
        }
        return { ok: false as const, status: 403, error: "Zustellauftrag ist nicht autorisiert." };
      }
      return { ok: false as const, status: error.code === "22023" ? 400 : 409, error: error.code === "22023" ? error.message : "Zustellauftrag konnte nicht angenommen werden." };
    }
    const ids: number[] = Array.isArray(claim?.eventIds) ? [...new Set<number>(claim.eventIds.map(Number).filter((n: number) => Number.isInteger(n) && n > 0))] : [];
    if (ids.length > limit || (!selection.testDelivery && selectedEventIds.length && ids.some(id => !selectedEventIds.includes(id))))
      claimFailure();
    const token = typeof claim?.claimToken === "string" ? claim.claimToken : "";
    if (!token || !ids.length)
      return { ok: true as const, claim: null };
    const reserved = Object.freeze([...ids]);
    let loaded: NotificationDeliveryRow[] = [];
    let profiles: NotificationDeliveryProfile[] = [];
    let loadStarted = false;
    let loadedReady = false;
    const attempted = new Map<number, boolean>();
    let finished = false;
    let originalClaimDeadline = Infinity;
    const recorded = new Set<number>();
    async function claimBinding(requireUnexpired: boolean) {
      if (finished)
        claimFailure();
      const result = await book.from("notification_delivery_claims").select("event_id,claim_token,claimed_by_profile_id,claim_authority,expires_at").in("event_id", [...reserved]);
      if (result.error || result.data?.length !== reserved.length)
        claimFailure();
      let expiresAt = Infinity;
      for (const id of reserved) {
        const row = result.data.find(row => Number(row.event_id) === id);
        const deadline = Date.parse(row?.expires_at || "");
        if (!row || row.claim_token !== token || row.claimed_by_profile_id !== admission.profileId || row.claim_authority !== (admission.mode === "pipeline" ? "pipeline" : "administrator") || !Number.isFinite(deadline))
          claimFailure();
        expiresAt = Math.min(expiresAt, deadline);
      }
      originalClaimDeadline = Math.min(originalClaimDeadline, expiresAt);
      const assert = () => {
        if (finished || (requireUnexpired && Date.now() >= originalClaimDeadline))
          claimFailure();
      };
      assert();
      return assert;
    }
    const restrictSend = async () => {
      const authority = await admission.reassert();
      const binding = await claimBinding(true);
      return () => { authority(); binding(); };
    };
    const claimCapability = Object.freeze({
      async load() {
        if (loadStarted)
          claimFailure();
        loadStarted = true;
        const assert = await restrictSend();
        assert();
        const events = await data.from("notification_events").select("id,type,actor_profile_id,recipient_profile_id,entity_type,entity_id,title,body,created_at").eq("status", "pending").in("id", [...reserved]).order("created_at", { ascending: true }).limit(reserved.length);
        if (events.error)
          return { ok: false as const, error: events.error };
        loaded = structuredClone(events.data || []) as NotificationDeliveryRow[];
        if (loaded.some(row => !reserved.includes(row.id)))
          claimFailure();
        const ids = loaded.map(row => row.id);
        const deliveries = ids.length ? await data.from("notification_deliveries").select("event_id,status").eq("channel", "google_chat").in("event_id", ids) : { data: [], error: null };
        const profileIds = [...new Set(loaded.flatMap(row => [row.actor_profile_id, row.recipient_profile_id]).filter((v): v is string => Boolean(v)))];
        const profileResult = profileIds.length ? await data.from("profiles").select("id,name,google_chat_user_id,google_chat_dm_space,notifications_enabled").in("id", profileIds) : { data: [], error: null };
        const preferences = profileIds.length ? await data.from("notification_preferences").select("profile_id,event_type,enabled").eq("channel", "google_chat").in("profile_id", profileIds) : { data: [], error: null };
        if (deliveries.error || preferences.error)
          return { ok: false as const, error: deliveries.error || preferences.error! };
        profiles = structuredClone(profileResult.data || []) as NotificationDeliveryProfile[];
        loadedReady = true;
        return { ok: true as const, events: structuredClone(loaded), existingDeliveries: deliveries.data || [], profiles: structuredClone(profiles), preferences: (preferences.data || []) as NotificationDeliveryPreference[] };
      },
      async send(mode: "direct_dm" | "webhook_digest", target: string, selectedIds: readonly number[], message: GoogleChatMessage) {
        if (!loadedReady)
          claimFailure();
        const sendIds = [...selectedIds];
        const sendRows = sendIds.map(id => structuredClone(loaded.find(row => row.id === id)));
        const body = structuredClone(message);
        if (!sendIds.length || new Set(sendIds).size !== sendIds.length || (mode === "webhook_digest" && target !== "founder-ops-space"))
          claimFailure();
        for (const id of sendIds) {
          const row = loaded.find(row => row.id === id);
          if (!row || attempted.has(id))
            claimFailure();
          const recipient = profiles.find(profile => profile.id === row.recipient_profile_id);
          if (mode === "direct_dm" ? !row.recipient_profile_id || !shouldSendToGoogleChatDm(row.type) || recipient?.google_chat_dm_space !== target : Boolean(row.recipient_profile_id && shouldSendToGoogleChatDm(row.type)))
            claimFailure();
        }
        for (const id of sendIds)
          attempted.set(id, false);
        const restrictTarget = async () => {
          const binding = await claimBinding(true);
          if (mode === "direct_dm") {
            const recipientIds = sendRows.map(row => row!.recipient_profile_id!);
            const current = await book.from("profiles").select("id,google_chat_dm_space,notifications_enabled").in("id", recipientIds);
            if (current.error || recipientIds.some(id => !current.data?.some(row => row.id === id && row.google_chat_dm_space === target && row.notifications_enabled !== false)))
              claimFailure("Zustellziel ist nicht mehr gültig.");
          }
          const authority = await admission.reassert();
          const assert = () => { authority(); binding(); };
          assert();
          return assert;
        };
        await runWithDeliveryAdmission(restrictTarget, async () => {
          const assert = await restrictTarget();
          assert();
          const chat = await authorizeGoogleChat(mode === "direct_dm" ? { credential: { kind: "google-chat-bot" }, action: "google-chat.space.deliver", target } : { credential: { kind: "google-chat-webhook" }, action: "google-chat.webhook.deliver" });
          await chat.chat.send(body);
        });
        for (const id of sendIds)
          attempted.set(id, true);
      },
      async record(rows: readonly DeliveryRecordRow[], status: "sent" | "failed", attempts: number, extras: {
        deliveredAt?: string;
        deliveryMode?: "direct_dm" | "webhook_digest";
        error?: string;
        digestSize?: number;
      }) {
        const snapshot = structuredClone({ rows, status, attempts, extras });
        if (new Set(snapshot.rows.map(({ row }) => row.id)).size !== snapshot.rows.length)
          claimFailure();
        const assert = await claimBinding(false);
        assert();
        for (const { row, target } of snapshot.rows) {
          if (recorded.has(row.id) || !loaded.some(event => event.id === row.id))
            claimFailure();
          const attempt = attempted.get(row.id);
          const expected = profiles.find(profile => profile.id === row.recipient_profile_id)?.google_chat_dm_space || "founder-ops-space";
          if (target !== expected)
            claimFailure();
          if (status === "sent" && attempt !== true)
            claimFailure();
          if (attempts > 0 && !attempted.has(row.id))
            claimFailure();
        }
        if (!snapshot.rows.length)
          return;
        snapshot.rows.forEach(({ row }) => recorded.add(row.id));
        const result = await book.from("notification_deliveries").insert(snapshot.rows.map(({ row, target, payload }) => ({ event_id: row.id, channel: "google_chat", status, attempts, target,
          payload: { ...payload, ...(snapshot.extras.deliveryMode ? { deliveryMode: snapshot.extras.deliveryMode } : {}), ...(snapshot.extras.digestSize ? { digestSize: snapshot.extras.digestSize } : {}) }, delivered_at: snapshot.extras.deliveredAt || null, last_error: snapshot.extras.error || null })));
        if (result.error)
          throw new Error("Zustellstatus konnte nicht gespeichert werden.");
      },
      async finalize() {
        const assert = await claimBinding(false);
        assert();
        const result = await book.rpc("finalize_notification_delivery_claim", { p_claim_token: token, p_event_ids: [...reserved] });
        if (result.error || Number(result.data) !== reserved.length)
          claimFailure();
        finished = true;
      },
      async release() {
        if (finished)
          return;
        const assert = await claimBinding(false);
        assert();
        await book.rpc("release_notification_delivery_claim", { p_claim_token: token });
        finished = true;
      },
    });
    return { ok: true as const, claim: claimCapability };
  }
  let reconciliation: ReturnType<typeof reconcileNotificationEvents> | undefined;
  return { ok: true as const, delivery: Object.freeze({
      reconcile: () => admission.mode === "pipeline" ? reconciliation ??= reconcileNotificationEvents(data) : Promise.resolve(),
      reserve: () => reservation ??= reserve()
    }) };
}
