import { founderScore, taskBelongsToProfile } from "@/lib/platform";
import { computeFounderSprintScore } from "@/lib/founderops-scoring";
import { findCurrentSprint } from "@/lib/planning-schedule";
import { normalizeStatus } from "@/lib/status";
import type { CommitmentLevel, PlanningData, Profile } from "@/lib/types";

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
  ["acceptanceCriteriaMet", "Abnahmekriterien erfüllt", "2,5 Punkte"],
  ["evidenceProvided", "Nachweis/Link liegt vor", "2,5 Punkte"],
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
    const profileTasks = sprintTasks.filter((task) => taskBelongsToProfile(task, profile));
    const commitment = data.sprintCommitments.find((item) => item.sprintId === sprint?.id && item.profileId === profile.id);
    const sprintMeetings = sprint ? data.meetings.filter((item) => item.sprintId === sprint.id) : [];
    const persistedScore = data.founderSprintScores.find((item) => item.sprintId === sprint?.id && item.profileId === profile.id);
    const computedScore = computeFounderSprintScore({
      profile,
      tasks: sprintTasks,
      commitment,
      meetings: sprintMeetings,
      meetingAttendance: data.meetingAttendance,
    });
    const strikeState = data.founderStrikeStates.find((item) => item.profileId === profile.id);
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
      v21Score: persistedScore || computedScore,
      strikeState,
      openScoreObjections: data.scoreObjections.filter((item) => item.sprintId === sprint?.id && item.profileId === profile.id && item.status === "open").length,
    };
  });
  const reviewTasks = sprintTasks.filter((task) => task.reviewStatus !== "not_requested" || task.status === "Review");
  const meetings = sprint ? data.meetings.filter((item) => item.sprintId === sprint.id).sort((a, b) => a.meetingAt.localeCompare(b.meetingAt)) : [];
  const meeting = meetings[0];
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
    meetings,
    finalScores,
    openScores,
    sprintHasTasks,
    sprintIsCurrent,
  };
}
