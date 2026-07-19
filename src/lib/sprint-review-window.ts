const REVIEW_TIME_ZONE = "Europe/Berlin";
const HOUR_MS = 60 * 60 * 1000;
export const DEFAULT_REVIEW_OBJECTION_WINDOW_HOURS = 48;
export const MAX_REVIEW_OBJECTION_WINDOW_HOURS = 336;

function parseIsoDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return { year, month, day };
}

function timeZoneOffsetMs(date: Date) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: REVIEW_TIME_ZONE,
    timeZoneName: "longOffset",
  });
  const value = formatter.formatToParts(date).find((part) => part.type === "timeZoneName")?.value || "GMT+00:00";
  const match = /^GMT([+-])(\d{1,2})(?::?(\d{2}))?$/.exec(value);
  if (!match) throw new Error(`Unsupported ${REVIEW_TIME_ZONE} offset: ${value}`);
  const sign = match[1] === "+" ? 1 : -1;
  return sign * (Number(match[2]) * 60 + Number(match[3] || 0)) * 60 * 1000;
}

export function sprintEndsAt(endDate: string) {
  const parsed = parseIsoDate(endDate);
  if (!parsed) return "";
  const localWallClock = Date.UTC(parsed.year, parsed.month - 1, parsed.day, 23, 59, 59, 999);
  const utcInstant = localWallClock - timeZoneOffsetMs(new Date(localWallClock));
  return new Date(utcInstant).toISOString();
}

export function sprintReviewDueAt(endDate: string, windowHours = DEFAULT_REVIEW_OBJECTION_WINDOW_HOURS) {
  const sprintEnd = sprintEndsAt(endDate);
  if (!sprintEnd || !Number.isInteger(windowHours) || windowHours < 1 || windowHours > MAX_REVIEW_OBJECTION_WINDOW_HOURS) return "";
  return new Date(new Date(sprintEnd).getTime() + windowHours * HOUR_MS).toISOString();
}

export function sprintObjectionWindowState(endDate: string, reviewDueAt: string, now = new Date()) {
  const sprintEnd = sprintEndsAt(endDate);
  const dueAt = reviewDueAt || sprintReviewDueAt(endDate);
  const nowTime = now.getTime();
  return {
    startsAt: sprintEnd,
    dueAt,
    open: Boolean(sprintEnd && dueAt && nowTime > new Date(sprintEnd).getTime() && nowTime <= new Date(dueAt).getTime()),
  };
}
