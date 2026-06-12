export type GoogleCalendarEvent = {
  id: string;
  summary?: string;
  start?: {
    date?: string;
    dateTime?: string;
  };
  end?: {
    date?: string;
    dateTime?: string;
  };
};

type GoogleTokenResponse = {
  access_token?: string;
  error?: string;
  error_description?: string;
};

type GoogleEventsResponse = {
  items?: GoogleCalendarEvent[];
  error?: {
    message?: string;
  };
};

type GoogleEventWriteResponse = {
  id?: string;
  htmlLink?: string;
  error?: {
    message?: string;
  };
};

const calendarScopes = [
  "https://www.googleapis.com/auth/calendar.events",
].join(" ");

function base64Url(input: string | Buffer) {
  return Buffer.from(input).toString("base64url");
}

function serviceAccountEmail() {
  return process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "";
}

function serviceAccountKey() {
  return (process.env.GOOGLE_SERVICE_ACCOUNT_KEY || "").replace(/\\n/g, "\n");
}

export function isGoogleCalendarSyncConfigured() {
  return Boolean(serviceAccountEmail() && serviceAccountKey());
}

async function googleAccessToken(subjectEmail: string) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64Url(JSON.stringify({
    iss: serviceAccountEmail(),
    scope: calendarScopes,
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
    sub: subjectEmail,
  }));
  const unsignedJwt = `${header}.${claim}`;

  const { createSign } = await import("node:crypto");
  const signature = createSign("RSA-SHA256").update(unsignedJwt).sign(serviceAccountKey(), "base64url");
  const assertion = `${unsignedJwt}.${signature}`;

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });

  const body = (await response.json().catch(() => ({}))) as GoogleTokenResponse;
  if (!response.ok || !body.access_token) {
    throw new Error(body.error_description || body.error || "Google Calendar Token konnte nicht erstellt werden.");
  }

  return body.access_token;
}

export async function getGoogleCalendarEvents(subjectEmail: string, startDate: string, endDate: string) {
  if (!isGoogleCalendarSyncConfigured()) throw new Error("Google Calendar ist noch nicht konfiguriert.");

  const token = await googleAccessToken(subjectEmail);
  const params = new URLSearchParams({
    timeMin: `${startDate}T00:00:00+01:00`,
    timeMax: `${endDate}T23:59:59+01:00`,
    singleEvents: "true",
    orderBy: "startTime",
    showDeleted: "false",
  });

  const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params.toString()}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const body = (await response.json().catch(() => ({}))) as GoogleEventsResponse;

  if (!response.ok) {
    throw new Error(body.error?.message || "Google Calendar konnte nicht gelesen werden.");
  }

  return body.items || [];
}

export async function createGoogleCalendarEvent(payload: {
  organizerEmail: string;
  attendeeEmails: string[];
  title: string;
  agenda: string;
  startIso: string;
  durationMinutes: number;
}) {
  if (!isGoogleCalendarSyncConfigured()) throw new Error("Google Calendar ist noch nicht konfiguriert.");
  if (!payload.organizerEmail) throw new Error("Kein Google-Kalender für den Organizer hinterlegt.");

  const token = await googleAccessToken(payload.organizerEmail);
  const start = new Date(payload.startIso);
  if (Number.isNaN(start.getTime())) throw new Error("Meeting-Zeitpunkt ist ungültig.");
  const end = new Date(start.getTime() + payload.durationMinutes * 60 * 1000);
  const uniqueAttendees = Array.from(new Set(payload.attendeeEmails.map((email) => email.trim()).filter(Boolean)));

  const response = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=all", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      summary: payload.title,
      description: payload.agenda,
      start: { dateTime: start.toISOString(), timeZone: "Europe/Berlin" },
      end: { dateTime: end.toISOString(), timeZone: "Europe/Berlin" },
      attendees: uniqueAttendees.map((email) => ({ email })),
    }),
  });
  const body = (await response.json().catch(() => ({}))) as GoogleEventWriteResponse;

  if (!response.ok || !body.id) {
    throw new Error(body.error?.message || "Google Calendar Event konnte nicht erstellt werden.");
  }

  return {
    calendarId: payload.organizerEmail,
    eventId: body.id,
    htmlLink: body.htmlLink || "",
  };
}
