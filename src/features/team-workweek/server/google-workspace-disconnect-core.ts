import {
  FOUNDEROPS_WORKWEEK_PROPERTY_KEY,
  type GoogleWorkweekSeriesResult,
} from "./team-workweek-publication-core";

export type DisconnectDeleteTarget = Readonly<{
  calendarId: "primary";
  googleEventId: string;
  seriesId: string;
  expectedEtag: string;
  expectedFounderopsRevision: number;
}>;

type GoogleCalendarEvent = Readonly<{
  id?: unknown;
  etag?: unknown;
  extendedProperties?: Readonly<{ private?: Readonly<Record<string, unknown>> }>;
}>;

function endpoint(target: DisconnectDeleteTarget) {
  return `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(target.calendarId)}/events/${encodeURIComponent(target.googleEventId)}`;
}

function matchingIdentity(event: GoogleCalendarEvent, target: DisconnectDeleteTarget) {
  const properties = event.extendedProperties?.private;
  return event.id === target.googleEventId
    && properties?.[FOUNDEROPS_WORKWEEK_PROPERTY_KEY] === target.seriesId
    && properties?.founderopsWorkweekRevision === String(target.expectedFounderopsRevision);
}

export async function observeGoogleWorkweekSeriesForDisconnect({
  accessToken,
  fetchImpl = fetch,
  target,
}: {
  accessToken: string;
  fetchImpl?: typeof fetch;
  target: DisconnectDeleteTarget;
}): Promise<{ state: "present"; etag: string } | { state: "absent" } | Extract<GoogleWorkweekSeriesResult, { state: "delayed" }>> {
  let response: Response;
  try {
    const url = new URL(endpoint(target));
    url.searchParams.set("fields", "id,etag,extendedProperties/private");
    response = await fetchImpl(url, {
      headers: { authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
  } catch {
    return { state: "delayed", errorClass: "provider_unavailable" };
  }
  if (response.status === 404 || response.status === 410) return { state: "absent" };
  if (response.status === 401 || response.status === 403) {
    return { state: "delayed", errorClass: "oauth_reconnect_required" };
  }
  if (!response.ok) return { state: "delayed", errorClass: "provider_unavailable" };
  const event = await response.json().catch(() => null) as GoogleCalendarEvent | null;
  if (!event || !matchingIdentity(event, target) || typeof event.etag !== "string" || !event.etag) {
    return { state: "delayed", errorClass: "provider_identity_mismatch" };
  }
  return { state: "present", etag: event.etag };
}

export async function ensureGoogleWorkweekSeriesAbsent({
  accessToken,
  fetchImpl = fetch,
  now = () => new Date(),
  target,
}: {
  accessToken: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  target: DisconnectDeleteTarget;
}): Promise<GoogleWorkweekSeriesResult> {
  const current = await observeGoogleWorkweekSeriesForDisconnect({ fetchImpl, accessToken, target });
  if (current.state === "absent") {
    return { state: "confirmed", etag: target.expectedEtag, observedAt: now().toISOString() };
  }
  if (current.state === "delayed") return current;
  if (current.etag !== target.expectedEtag) {
    return { state: "delayed", errorClass: "provider_identity_mismatch" };
  }

  let response: Response;
  try {
    response = await fetchImpl(endpoint(target), {
      method: "DELETE",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "if-match": target.expectedEtag,
      },
      cache: "no-store",
    });
  } catch {
    const recovered = await observeGoogleWorkweekSeriesForDisconnect({ fetchImpl, accessToken, target });
    return recovered.state === "absent"
      ? { state: "confirmed", etag: target.expectedEtag, observedAt: now().toISOString() }
      : recovered.state === "delayed"
        ? recovered
        : { state: "delayed", errorClass: "provider_unavailable" };
  }
  if (response.ok || response.status === 404 || response.status === 410) {
    return { state: "confirmed", etag: target.expectedEtag, observedAt: now().toISOString() };
  }
  if (response.status === 401 || response.status === 403) {
    return { state: "delayed", errorClass: "oauth_reconnect_required" };
  }
  if (response.status === 412) {
    const recovered = await observeGoogleWorkweekSeriesForDisconnect({ fetchImpl, accessToken, target });
    return recovered.state === "absent"
      ? { state: "confirmed", etag: target.expectedEtag, observedAt: now().toISOString() }
      : { state: "delayed", errorClass: "provider_identity_mismatch" };
  }
  return { state: "delayed", errorClass: "provider_unavailable" };
}
