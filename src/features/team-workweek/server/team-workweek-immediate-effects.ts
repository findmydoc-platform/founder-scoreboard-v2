import type { GoogleWorkweekSeriesResult } from "./team-workweek-publication-core";

export type WorkweekGooglePayload = Readonly<{
  id: string;
  start: Readonly<{ dateTime: string; timeZone: "Europe/Berlin" }>;
  end: Readonly<{ dateTime: string; timeZone: "Europe/Berlin" }>;
  recurrence?: readonly string[];
  extendedProperties: Readonly<{ private: Readonly<Record<string, string>> }>;
}>;

export type PreparedWorkweekEffect = Readonly<{
  id: string;
  calendarId: "primary";
  googleEventId: string;
  generation: number;
  payload: WorkweekGooglePayload;
  state: "pending" | "confirmed" | "cleaned";
  confirmedEtag: string | null;
}>;

type ObservedEvent = Partial<WorkweekGooglePayload> & { etag?: string };

function endpoint(effect: PreparedWorkweekEffect, collection = false) {
  const base = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
  return collection ? `${base}?sendUpdates=none` : `${base}/${encodeURIComponent(effect.googleEventId)}`;
}

function matchesEffect(event: ObservedEvent | null, effect: PreparedWorkweekEffect) {
  const properties = event?.extendedProperties?.private;
  const expected = effect.payload;
  return event?.id === effect.googleEventId
    && Boolean(event.etag?.trim())
    && Object.entries(expected.extendedProperties.private).every(([key, value]) => properties?.[key] === value)
    && event.start?.timeZone === "Europe/Berlin" && event.end?.timeZone === "Europe/Berlin"
    && new Date(event.start.dateTime).getTime() === new Date(expected.start.dateTime).getTime()
    && new Date(event.end.dateTime).getTime() === new Date(expected.end.dateTime).getTime()
    && JSON.stringify(event.recurrence || []) === JSON.stringify(expected.recurrence || []);
}

function errorFor(response: Response): GoogleWorkweekSeriesResult {
  return { state: "delayed", errorClass: response.status === 401 || response.status === 403
    ? "oauth_reconnect_required" : "provider_unavailable" };
}

async function observe(fetchImpl: typeof fetch, accessToken: string, effect: PreparedWorkweekEffect) {
  try {
    const response = await fetchImpl(endpoint(effect), {
      headers: { authorization: `Bearer ${accessToken}` }, cache: "no-store", signal: AbortSignal.timeout(8_000),
    });
    if (response.status === 404 || response.status === 410) return { state: "absent" as const };
    if (!response.ok) return errorFor(response);
    const event = await response.json().catch(() => null) as ObservedEvent | null;
    return matchesEffect(event, effect)
      ? { state: "confirmed" as const, etag: event!.etag! }
      : { state: "delayed" as const, errorClass: "provider_identity_mismatch" as const };
  } catch {
    return { state: "delayed" as const, errorClass: "provider_unavailable" as const };
  }
}

export async function ensureGoogleWorkweekEffect({ accessToken, effect, fetchImpl = fetch, now = () => new Date() }: {
  accessToken: string; effect: PreparedWorkweekEffect; fetchImpl?: typeof fetch; now?: () => Date;
}): Promise<GoogleWorkweekSeriesResult> {
  const observed = await observe(fetchImpl, accessToken, effect);
  if (observed.state === "confirmed") return { ...observed, observedAt: now().toISOString() };
  if (observed.state === "delayed") return observed;
  try {
    const response = await fetchImpl(endpoint(effect, true), {
      method: "POST", headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
      body: JSON.stringify(effect.payload), cache: "no-store", signal: AbortSignal.timeout(8_000),
    });
    if (response.ok) {
      const event = await response.json().catch(() => null) as ObservedEvent | null;
      return matchesEffect(event, effect)
        ? { state: "confirmed", etag: event!.etag!, observedAt: now().toISOString() }
        : { state: "delayed", errorClass: "provider_identity_mismatch" };
    }
    if (response.status !== 409 && response.status < 500) return errorFor(response);
  } catch {
    // A lost response does not prove that Google rejected the immutable mutation.
  }
  const recovered = await observe(fetchImpl, accessToken, effect);
  return recovered.state === "confirmed" ? { ...recovered, observedAt: now().toISOString() }
    : recovered.state === "delayed" ? recovered : { state: "delayed", errorClass: "provider_unavailable" };
}

export async function cleanupGoogleWorkweekEffect({ accessToken, effect, fetchImpl = fetch, now = () => new Date() }: {
  accessToken: string; effect: PreparedWorkweekEffect; fetchImpl?: typeof fetch; now?: () => Date;
}): Promise<GoogleWorkweekSeriesResult> {
  const observed = await observe(fetchImpl, accessToken, effect);
  if (observed.state === "absent") return { state: "confirmed", etag: "absent", observedAt: now().toISOString() };
  if (observed.state === "delayed") return observed;
  try {
    const response = await fetchImpl(`${endpoint(effect)}?sendUpdates=none`, {
      method: "DELETE", headers: { authorization: `Bearer ${accessToken}`, "if-match": observed.etag },
      cache: "no-store", signal: AbortSignal.timeout(8_000),
    });
    if (response.ok || response.status === 404 || response.status === 410) {
      return { state: "confirmed", etag: observed.etag, observedAt: now().toISOString() };
    }
    if (response.status === 412) return { state: "delayed", errorClass: "provider_identity_mismatch" };
    if (response.status < 500) return errorFor(response);
  } catch {
    // Observe before replaying a DELETE whose response was lost.
  }
  const recovered = await observe(fetchImpl, accessToken, effect);
  return recovered.state === "absent" ? { state: "confirmed", etag: "absent", observedAt: now().toISOString() }
    : recovered.state === "delayed" ? recovered : { state: "delayed", errorClass: "provider_unavailable" };
}
