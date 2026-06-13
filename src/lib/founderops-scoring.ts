import type { FounderStrikeState, Meeting, MeetingAttendance, Profile, SprintCommitment, StrikeEventType, Task } from "@/lib/types";

export type SprintScoreInput = {
  profile: Profile;
  tasks: Task[];
  commitment?: SprintCommitment;
  meetings: Meeting[];
  meetingAttendance: MeetingAttendance[];
};

export type ComputedFounderSprintScore = {
  profileId: string;
  deliveryPoints: number;
  formPoints: number;
  weeklyPoints: number;
  totalPoints: number;
  fulfilled: boolean;
  awayNeutral: boolean;
  reasonSummary: string;
};

export type ComputedStrikeTransition = {
  eventType: StrikeEventType;
  previousStrikeLevel: number;
  nextStrikeLevel: number;
  fulfilledResetStreak: number;
  governanceReviewRequired: boolean;
  reason: string;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

export function scoreRelevantDeliverables(tasks: Task[], profile: Profile) {
  return tasks.filter((task) =>
    task.owner === profile.name &&
    task.taskType === "deliverable" &&
    task.scoreRelevant !== false
  );
}

function deliveryPoints(tasks: Task[]) {
  if (!tasks.length) return 0;
  const raw = tasks.reduce((sum, task) => {
    if (task.reviewStatus === "accepted") return sum + 1;
    if (task.reviewStatus === "partial") return sum + 0.5;
    return sum;
  }, 0);
  return clamp((raw / tasks.length) * 12, 0, 12);
}

function formPoints(tasks: Task[]) {
  if (!tasks.length) return 0;
  const raw = tasks.reduce((sum, task) => {
    const checks = [
      task.definitionOfDone.trim(),
      task.evidenceLink.trim() || task.githubIssueUrl.trim() || task.issueUrl.trim(),
      task.reviewStatus !== "not_requested" || task.status === "Review" || task.status === "Erledigt",
      task.sprintOutcome === "communicated_blocker" || task.reviewStatus === "accepted" || task.reviewStatus === "partial",
    ].filter(Boolean).length;
    return sum + checks / 4;
  }, 0);
  return clamp((raw / tasks.length) * 4, 0, 4);
}

function weeklyPoints(profile: Profile, meetings: Meeting[], attendance: MeetingAttendance[]) {
  const sprintMeetings = meetings
    .filter((meeting) => meeting.status !== "cancelled")
    .sort((a, b) => a.meetingAt.localeCompare(b.meetingAt))
    .slice(0, 2);

  const total = sprintMeetings.reduce((sum, meeting) => {
    const item = attendance.find((entry) => entry.meetingId === meeting.id && entry.profileId === profile.id);
    if (!item) return sum;
    return sum + clamp(item.points, 0, 2);
  }, 0);

  return clamp(total, 0, 4);
}

export function computeFounderSprintScore(input: SprintScoreInput): ComputedFounderSprintScore {
  const awayNeutral = input.commitment?.commitmentLevel === "Away";
  const deliverables = scoreRelevantDeliverables(input.tasks, input.profile);
  const delivery = awayNeutral ? 0 : deliveryPoints(deliverables);
  const form = awayNeutral ? 0 : formPoints(deliverables);
  const weekly = awayNeutral ? 0 : weeklyPoints(input.profile, input.meetings, input.meetingAttendance);
  const total = clamp(delivery + form + weekly, 0, 20);
  const fulfilled = !awayNeutral && total >= 12;
  const reasonSummary = awayNeutral
    ? "Away-Sprint: neutral für Strike und Reset."
    : `Delivery ${delivery}/12, Form / Review-Reife ${form}/4, Weekly ${weekly}/4.`;

  return {
    profileId: input.profile.id,
    deliveryPoints: delivery,
    formPoints: form,
    weeklyPoints: weekly,
    totalPoints: total,
    fulfilled,
    awayNeutral,
    reasonSummary,
  };
}

export function computeStrikeTransition(
  score: Pick<ComputedFounderSprintScore, "fulfilled" | "awayNeutral" | "totalPoints">,
  currentState?: Pick<FounderStrikeState, "strikeLevel" | "fulfilledResetStreak"> | null,
): ComputedStrikeTransition {
  const previous = clamp(currentState?.strikeLevel || 0, 0, 3);
  const previousStreak = Math.max(0, currentState?.fulfilledResetStreak || 0);

  if (score.awayNeutral) {
    return {
      eventType: "away_neutral",
      previousStrikeLevel: previous,
      nextStrikeLevel: previous,
      fulfilledResetStreak: previousStreak,
      governanceReviewRequired: false,
      reason: "Away-Sprint zählt weder positiv noch negativ.",
    };
  }

  if (!score.fulfilled) {
    const next = clamp(previous + 1, 0, 3);
    return {
      eventType: next === 3 ? "governance_review_required" : "strike_added",
      previousStrikeLevel: previous,
      nextStrikeLevel: next,
      fulfilledResetStreak: 0,
      governanceReviewRequired: next === 3,
      reason: `Sprint mit ${score.totalPoints}/20 nicht erfüllt.`,
    };
  }

  if (previous === 0) {
    return {
      eventType: "fulfilled_no_change",
      previousStrikeLevel: 0,
      nextStrikeLevel: 0,
      fulfilledResetStreak: 0,
      governanceReviewRequired: false,
      reason: `Sprint mit ${score.totalPoints}/20 erfüllt.`,
    };
  }

  if (previous === 1) {
    return {
      eventType: "strike_reset",
      previousStrikeLevel: 1,
      nextStrikeLevel: 0,
      fulfilledResetStreak: 0,
      governanceReviewRequired: false,
      reason: "Strike 1 nach einem erfüllten Sprint zurückgesetzt.",
    };
  }

  if (previous === 2 && previousStreak + 1 >= 2) {
    return {
      eventType: "strike_reset",
      previousStrikeLevel: 2,
      nextStrikeLevel: 0,
      fulfilledResetStreak: 0,
      governanceReviewRequired: false,
      reason: "Strike 2 nach zwei erfüllten Sprints in Folge zurückgesetzt.",
    };
  }

  return {
    eventType: "fulfilled_no_change",
    previousStrikeLevel: previous,
    nextStrikeLevel: previous,
    fulfilledResetStreak: previous === 2 ? previousStreak + 1 : previousStreak,
    governanceReviewRequired: false,
    reason: `Sprint mit ${score.totalPoints}/20 erfüllt; Reset-Serie läuft.`,
  };
}
