export type DeliverableScheduleSprint = Readonly<{
  id: string;
  name: string;
  startDate: string;
  endDate: string;
}>;

export type DeliverableScheduleInput = Readonly<{
  sprintId: string | null;
  fixedDate: string | null;
}>;

export type DeliverableSchedule = DeliverableScheduleInput & Readonly<{
  sprint: DeliverableScheduleSprint | null;
}>;

export function normalizeFixedDate(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
    ? value
    : null;
}

export function projectDeliverableSchedule(
  input: DeliverableScheduleInput,
  sprints: readonly DeliverableScheduleSprint[],
): DeliverableSchedule {
  const sprintId = input.sprintId || null;
  return {
    sprintId,
    fixedDate: normalizeFixedDate(input.fixedDate),
    sprint: sprintId ? sprints.find((sprint) => sprint.id === sprintId) || null : null,
  };
}
