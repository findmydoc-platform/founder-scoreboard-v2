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

const calendarScopes = [
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.events.readonly",
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
