import { founderScore } from "@/lib/platform";
import { normalizeStatus } from "@/lib/status";
import type { CommitmentLevel, PlanningData, Profile, Sprint } from "@/lib/types";

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

export function reviewChecklistScore(checklist: { acceptanceCriteriaMet?: boolean; dodMet?: boolean; evidenceProvided?: boolean; communicationClear?: boolean; blockerHandled?: boolean }) {
  const checked = [
    checklist.acceptanceCriteriaMet ?? checklist.dodMet,
    checklist.evidenceProvided,
    checklist.communicationClear,
    checklist.blockerHandled,
  ].filter(Boolean).length;
  return Math.round((checked / 4) * 10);
}

export const reviewChecklistItems = [
  ["acceptanceCriteriaMet", "Acceptance Criteria erfüllt", "2,5 Punkte"],
  ["evidenceProvided", "Evidence/Link liegt vor", "2,5 Punkte"],
  ["communicationClear", "Ergebnis und Kommunikation nachvollziehbar", "2,5 Punkte"],
  ["blockerHandled", "Blocker/Abhängigkeiten sauber geklärt", "2,5 Punkte"],
] as const;

export function buildSprintScoreViewModel({
  data,
  selectedSprintId,
}: {
  data: PlanningData;
  selectedSprintId: string;
}) {
  const currentSprint = findCurrentSprint(data.sprints);
  const sprint = data.sprints.find((item) => item.id === selectedSprintId) || currentSprint || data.sprints[0];
  const sprintTasks = sprint ? data.tasks.filter((task) => task.sprintId === sprint.id) : data.tasks;
  const otherTasks = sprint ? data.tasks.filter((task) => task.sprintId !== sprint.id) : [];
  const unassignedTasks = data.tasks.filter((task) => !task.sprintId);
  const scoreRows = data.profiles.map((profile: Profile) => {
    const row = founderScore(sprintTasks, profile);
    const profileTasks = sprintTasks.filter((task) => task.owner === profile.name);
    const commitment = data.sprintCommitments.find((item) => item.sprintId === sprint?.id && item.profileId === profile.id);
    return {
      ...row,
      commitment: commitment || {
        id: 0,
        sprintId: sprint?.id || "",
        profileId: profile.id,
        commitmentLevel: "Standard" as CommitmentLevel,
        weeklyHours: profile.weeklyCapacity,
        note: "",
      },
      hours: profileTasks.reduce((sum, task) => sum + task.hours, 0),
      blocked: profileTasks.filter((task) => normalizeStatus(task.status) === "Blockiert").length,
      active: profileTasks.filter((task) => normalizeStatus(task.status) === "In Arbeit").length,
      finalScore: profileTasks.filter((task) => task.scoreFinal).length,
    };
  });
  const reviewTasks = sprintTasks.filter((task) => task.reviewStatus !== "not_requested" || task.status === "Review");
  const meeting = sprint ? data.meetings.find((item) => item.sprintId === sprint.id) : undefined;
  const finalScores = sprintTasks.filter((task) => task.scoreFinal).length;
  const openScores = sprintTasks.filter((task) => !task.scoreFinal).length;
  const sprintHasTasks = sprintTasks.length > 0;
  const sprintIsCurrent = currentSprint?.id === sprint?.id;

  return {
    currentSprint,
    sprint,
    sprintTasks,
    otherTasks,
    unassignedTasks,
    scoreRows,
    reviewTasks,
    meeting,
    finalScores,
    openScores,
    sprintHasTasks,
    sprintIsCurrent,
  };
}
