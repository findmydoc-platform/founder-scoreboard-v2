import type { Sprint } from "@/lib/types";

export function sprintNumber(value: string) {
  const match = value.match(/sprint\D*(\d+)/i) || value.match(/(\d+)$/);
  return match ? Number(match[1]) : 0;
}

export function addDaysIso(value: string, days: number) {
  const date = value ? new Date(`${value}T00:00:00`) : new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

export function currentIsoDate() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function findCurrentSprint(sprints: Sprint[], today = currentIsoDate()) {
  return sprints.find((sprint) => sprint.startDate <= today && sprint.endDate >= today)
    || sprints.find((sprint) => sprint.status === "active")
    || sprints.find((sprint) => sprint.status === "planning" || sprint.status === "review")
    || sprints[0];
}
