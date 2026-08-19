import { createHash } from "node:crypto";
import type { AuthenticatedProfile } from "@/lib/types";
import { ACTIVE_TASKS_TABLE } from "@/lib/planning-read-model";
import type { getServerSupabase } from "@/lib/supabase";
import { defaultGitHubRepository, resolveTaskGitHubRepository } from "@/lib/github-repositories";
import {
  FOUNDEROPS_PLANNING_PROJECT_ID,
  TEAM_PLANNING_ITEMS_MAX_BATCH_SIZE,
  TEAM_PLANNING_ITEM_CREATE_FIELDS,
  TEAM_PLANNING_ITEM_TYPES,
  TEAM_PLANNING_STRATEGIC_STATUSES,
  TEAM_PLANNING_SUB_ISSUE_STATUSES,
  TEAM_PLANNING_TASK_STATUSES,
  isStrategicPlanningItemType,
  parsePlanningItemGitHubSyncCommand,
  parsePlanningItemGitHubSyncMode,
  type PlanningItemGitHubSyncCommand,
  type PlanningItemGitHubSyncResult,
  type TeamPlanningItemGitHubSyncMode,
  type TeamPlanningItemType,
} from "@/features/planning-items/model/planning-items-contract";
import { previewPlanningItemGitHubSync } from "@/features/planning-items/model/planning-items-github-sync-preview";
import { isReviewStateLocked, reviewStateLockMessage, TASK_COMPLETED_LOCKED_MESSAGE } from "@/features/reviews/model/task-review-state";
import {
  intakeDate,
  intakeHours,
  intakePriority,
  intakeStringList,
  intakeText,
} from "@/features/planning-items/model/planning-item-normalization";
import type { ActorContext } from "./actor-context";
import type { CreateItems, NewPlanningItem, PlanningError, PlanningItems, PlanningResult } from "./planning-items";
import type { PlanningCommitOutcome, PlanningCommitRequest, PlanningPreparation, PlanningPreparationRequest } from "./planning-items-store";
import type { PlanningDecisionCore } from "./planning-items-runner";

type SupabaseServer = NonNullable<ReturnType<typeof getServerSupabase>>;

type ParentRow = {
  id: string;
  task_type: TeamPlanningItemType;
  approval_status: string | null;
  status: string | null;
  review_status: string | null;
  score_final: boolean | null;
  trashed_at: string | null;
};

export type PlanningItemCreateInput = {
  itemType?: unknown;
  title?: unknown;
  description?: unknown;
  problemStatement?: unknown;
  intendedOutcome?: unknown;
  scopeConstraints?: unknown;
  acceptanceCriteria?: unknown;
  evidenceRequired?: unknown;
  definitionOfDone?: unknown;
  parentTaskId?: unknown;
  ownerId?: unknown;
  accountableProfileId?: unknown;
  responsibleProfileIds?: unknown;
  consultedProfileIds?: unknown;
  informedProfileIds?: unknown;
  priority?: unknown;
  workstream?: unknown;
  startDate?: unknown;
  endDate?: unknown;
  deadline?: unknown;
  hours?: unknown;
  githubRepo?: unknown;
  targetDate?: unknown;
  status?: unknown;
  githubSync?: unknown;
};

export type PlanningItemCreatePreviewItem = {
  clientId: string;
  itemType: TeamPlanningItemType;
  title: string;
  description: string;
  problemStatement?: string;
  intendedOutcome?: string;
  scopeConstraints?: string;
  acceptanceCriteria?: string;
  evidenceRequired?: string;
  definitionOfDone?: string;
  parentTaskId?: string;
  ownerId?: string;
  accountableProfileId?: string;
  responsibleProfileIds?: string[];
  consultedProfileIds?: string[];
  informedProfileIds?: string[];
  priority?: string;
  workstream?: string;
  startDate?: string;
  endDate?: string;
  deadline?: string;
  hours?: number;
  githubRepo?: string;
  targetDate?: string;
  status?: string;
  approvalStatus: "proposed" | null;
  scoreRelevant?: false;
  githubSync?: PlanningItemGitHubSyncResult;
  errors: string[];
  warnings: string[];
};

const itemTypes = new Set<TeamPlanningItemType>(TEAM_PLANNING_ITEM_TYPES);
const inputKeys = new Set<string>([
  ...TEAM_PLANNING_ITEM_CREATE_FIELDS,
  "githubSync",
]);
const strategicStatuses = new Set<string>(TEAM_PLANNING_STRATEGIC_STATUSES);
const deliveryStatuses = new Set<string>(TEAM_PLANNING_TASK_STATUSES);
const subIssueStatuses = new Set<string>(TEAM_PLANNING_SUB_ISSUE_STATUSES);
const fieldsByType: Record<TeamPlanningItemType, Set<string>> = {
  epic: new Set(["itemType", "title", "description", "ownerId", "targetDate", "status"]),
  initiative: new Set([
    "itemType", "title", "description", "intendedOutcome", "scopeConstraints", "acceptanceCriteria",
    "parentTaskId", "ownerId", "accountableProfileId", "responsibleProfileIds",
    "consultedProfileIds", "informedProfileIds", "priority", "targetDate", "status",
  ]),
  deliverable: new Set([
    "itemType", "title", "description", "problemStatement", "intendedOutcome", "scopeConstraints",
    "acceptanceCriteria", "evidenceRequired", "definitionOfDone", "parentTaskId", "ownerId",
    "priority", "workstream", "startDate", "endDate", "deadline", "hours", "githubRepo", "status", "githubSync",
  ]),
  sub_issue: new Set([
    "itemType", "title", "description", "problemStatement", "intendedOutcome", "scopeConstraints",
    "acceptanceCriteria", "evidenceRequired", "definitionOfDone", "parentTaskId", "ownerId", "githubRepo", "status", "githubSync",
  ]),
};

function normalizedStatus(itemType: TeamPlanningItemType, value: unknown, errors: string[]) {
  const status = intakeText(value, 40);
  const fallback = "Offen";
  const result = status || fallback;
  const allowed = itemType === "epic" || itemType === "initiative"
    ? strategicStatuses
    : itemType === "sub_issue"
      ? subIssueStatuses
      : deliveryStatuses;
  if (!allowed.has(result)) {
    errors.push(`status ist für ${itemType} nicht zulässig.`);
  }
  return result;
}

function normalizedTextList(value: unknown) {
  return intakeStringList(value, 120);
}

function itemTypeForInput(value: unknown) {
  const requested = intakeText(value, 40);
  return {
    requested,
    itemType: TEAM_PLANNING_ITEM_TYPES.includes(requested as TeamPlanningItemType)
      ? requested as TeamPlanningItemType
      : null,
  };
}

export function planningItemCreateRequiresOperationalLead(items: PlanningItemCreateInput[]) {
  return items.some((item) => intakeText(item.itemType, 40) === "epic");
}

export function parsePlanningItemCreatePayload(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false as const, error: "Payload muss ein Objekt mit items sein." };
  }
  if (Object.keys(payload).some((key) => !["items", "githubSyncMode"].includes(key))) {
    return { ok: false as const, error: "Payload enthält unbekannte Felder." };
  }
  const items = (payload as { items?: unknown }).items;
  if (!Array.isArray(items) || items.length < 1 || items.length > TEAM_PLANNING_ITEMS_MAX_BATCH_SIZE) {
    return { ok: false as const, error: "items muss 1 bis 30 Einträge enthalten." };
  }
  const normalizedItems: PlanningItemCreateInput[] = [];
  let hasGitHubSync = false;
  for (const [index, item] of items.entries()) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return { ok: false as const, error: `Eintrag ${index + 1} muss ein Objekt sein.` };
    }
    const unknownKey = Object.keys(item).find((key) => !inputKeys.has(key));
    if (unknownKey) {
      return { ok: false as const, error: `Eintrag ${index + 1} enthält das unbekannte Feld ${unknownKey}.` };
    }
    const input = item as PlanningItemCreateInput;
    if (Object.hasOwn(input, "githubSync")) {
      const sync = parsePlanningItemGitHubSyncCommand(input.githubSync);
      if (!sync.ok) return { ok: false as const, error: `Eintrag ${index + 1}: ${sync.error}` };
      hasGitHubSync = true;
      normalizedItems.push({ ...input, githubSync: sync.command });
    } else {
      normalizedItems.push(input);
    }
  }
  const payloadRecord = payload as { githubSyncMode?: unknown };
  const hasMode = Object.hasOwn(payloadRecord, "githubSyncMode");
  const githubSyncMode = parsePlanningItemGitHubSyncMode(payloadRecord.githubSyncMode);
  if (hasGitHubSync && !githubSyncMode) {
    return { ok: false as const, error: "githubSyncMode muss bei GitHub-Sync async oder wait sein." };
  }
  if (!hasGitHubSync && hasMode) {
    return { ok: false as const, error: "githubSyncMode ist nur zusammen mit githubSync zulässig." };
  }
  return {
    ok: true as const,
    items: normalizedItems,
    githubSyncMode: githubSyncMode as TeamPlanningItemGitHubSyncMode | null,
  };
}

export async function buildPlanningItemCreatePreview(
  items: PlanningItemCreateInput[],
  actor: AuthenticatedProfile,
  supabase: SupabaseServer,
) {
  const [profilesResult, parentsResult] = await Promise.all([
    supabase.from("profiles").select("id,name"),
    supabase
      .from(ACTIVE_TASKS_TABLE)
      .select("id,task_type,approval_status,status,review_status,score_final,trashed_at")
      .eq("project_id", FOUNDEROPS_PLANNING_PROJECT_ID),
  ]);
  if (profilesResult.error || parentsResult.error) {
    throw new Error("Planning-Items-Kontext konnte nicht geladen werden.");
  }

  const profileIds = new Set((profilesResult.data || []).map((profile) => profile.id));
  const parents = new Map((parentsResult.data || []).map((parent) => [parent.id, parent as ParentRow]));

  return items.map((raw, index): PlanningItemCreatePreviewItem => {
    const errors: string[] = [];
    const warnings: string[] = [];
    const type = itemTypeForInput(raw.itemType);
    const itemType = type.itemType || "deliverable";
    if (!type.itemType || !itemTypes.has(itemType)) {
      errors.push("itemType muss epic, initiative, deliverable oder sub_issue sein.");
    }
    for (const field of Object.keys(raw)) {
      if (!fieldsByType[itemType].has(field)) errors.push(`${field} ist für ${itemType} nicht zulässig.`);
    }
    if (Object.hasOwn(raw, "githubSync") && isStrategicPlanningItemType(itemType)) {
      errors.push("GitHub-Sync ist für Epic und Initiative nicht verfügbar.");
    }

    const title = intakeText(raw.title, 240);
    if (title.length < 3) errors.push("Titel ist erforderlich.");
    const description = intakeText(raw.description, 4_000);
    const ownerId = intakeText(raw.ownerId, 120) || (itemType === "sub_issue" ? actor.id : "");
    if ((itemType === "epic" || itemType === "initiative") && !ownerId) {
      errors.push(`${itemType === "epic" ? "Epic" : "Initiative"} braucht einen Owner.`);
    }
    if (ownerId && !profileIds.has(ownerId)) errors.push("Owner wurde nicht gefunden.");
    if (itemType === "epic" && !["ceo", "deputy"].includes(actor.platformRole)) {
      errors.push("Nur CEO oder Deputy können Epics anlegen.");
    }
    if (itemType === "initiative" && !["ceo", "deputy"].includes(actor.platformRole)) {
      errors.push("Nur CEO oder Deputy können Initiativen vorschlagen.");
    }

    const parentTaskId = intakeText(raw.parentTaskId, 120);
    const parent = parentTaskId ? parents.get(parentTaskId) : null;
    if (itemType === "epic" && parentTaskId) errors.push("Epic darf keinen Parent haben.");
    if (itemType === "initiative" && parentTaskId && parent?.task_type !== "epic") {
      errors.push("Initiative braucht als Parent ein Epic.");
    }
    if (itemType === "deliverable" && parentTaskId) {
      if (parent?.task_type !== "initiative") errors.push("Deliverable braucht als Parent eine Initiative.");
      else if (parent.approval_status === "rejected") errors.push("Deliverables können nicht in einer abgelehnten Initiative liegen.");
    }
    if (itemType === "sub_issue") {
      if (!parent || parent.task_type !== "deliverable") errors.push("Sub-Issue braucht ein gültiges Parent-Deliverable.");
      else if (parent.approval_status !== "approved") errors.push("Sub-Issue braucht ein freigegebenes Parent-Deliverable.");
      else if (isReviewStateLocked(parent.review_status, Boolean(parent.score_final))) {
        errors.push(reviewStateLockMessage(parent.review_status, Boolean(parent.score_final)));
      } else if (parent.status === "Erledigt") errors.push(TASK_COMPLETED_LOCKED_MESSAGE);
    }

    const targetDate = intakeDate(raw.targetDate);
    if (raw.targetDate !== undefined && raw.targetDate !== null && intakeText(raw.targetDate, 20) && !targetDate) {
      errors.push("targetDate muss ein gültiges Datum im Format YYYY-MM-DD sein.");
    }
    if (raw.targetDate !== undefined && itemType !== "epic" && itemType !== "initiative") {
      errors.push(`targetDate ist für ${itemType} nicht zulässig.`);
    }
    const status = normalizedStatus(itemType, raw.status, errors);
    const startDate = intakeDate(raw.startDate);
    const endDate = intakeDate(raw.endDate);
    if (startDate && endDate && startDate > endDate) errors.push("Startdatum darf nicht nach dem Enddatum liegen.");

    const accountableProfileId = intakeText(raw.accountableProfileId, 120);
    const responsibleProfileIds = normalizedTextList(raw.responsibleProfileIds);
    const consultedProfileIds = normalizedTextList(raw.consultedProfileIds);
    const informedProfileIds = normalizedTextList(raw.informedProfileIds);
    for (const profileId of [accountableProfileId, ...responsibleProfileIds, ...consultedProfileIds, ...informedProfileIds]) {
      if (profileId && !profileIds.has(profileId)) errors.push("RACI enthält ein unbekanntes Profil.");
    }

    const requestedGitHubRepo = intakeText(raw.githubRepo, 120);
    const githubRepository = isStrategicPlanningItemType(itemType)
      ? { ok: true as const, repository: "" }
      : resolveTaskGitHubRepository(itemType === "sub_issue" ? "sub_issue" : "deliverable", requestedGitHubRepo);
    if (!githubRepository.ok) errors.push(githubRepository.error);
    const githubRepo = githubRepository.ok ? githubRepository.repository : defaultGitHubRepository;
    const githubSyncCommand = raw.githubSync as PlanningItemGitHubSyncCommand | undefined;
    const githubSync = githubSyncCommand && !isStrategicPlanningItemType(itemType)
      ? previewPlanningItemGitHubSync({
        itemType,
        approvalStatus: itemType === "deliverable" ? "proposed" : null,
        parentApprovalStatus: itemType === "sub_issue" ? parent?.approval_status : undefined,
      })
      : undefined;

    const preview: PlanningItemCreatePreviewItem = {
      clientId: `planning-items-create-${index + 1}`,
      itemType,
      title,
      description,
      parentTaskId,
      ownerId,
      status,
      approvalStatus: itemType === "initiative" || itemType === "deliverable" ? "proposed" : null,
      errors,
      warnings,
    };

    if (itemType === "epic" || itemType === "initiative") preview.targetDate = targetDate;

    if (itemType === "initiative") {
      Object.assign(preview, {
        intendedOutcome: intakeText(raw.intendedOutcome, 4_000) || description,
        scopeConstraints: intakeText(raw.scopeConstraints, 4_000),
        acceptanceCriteria: Array.isArray(raw.acceptanceCriteria)
          ? raw.acceptanceCriteria.map((value) => intakeText(value, 1_000)).filter(Boolean).join("\n")
          : intakeText(raw.acceptanceCriteria, 6_000),
        priority: intakePriority(raw.priority),
        accountableProfileId,
        responsibleProfileIds,
        consultedProfileIds,
        informedProfileIds,
      });
    }
    if (itemType === "deliverable" || itemType === "sub_issue") {
      Object.assign(preview, {
        problemStatement: intakeText(raw.problemStatement, 4_000),
        intendedOutcome: intakeText(raw.intendedOutcome, 4_000),
        scopeConstraints: intakeText(raw.scopeConstraints, 4_000),
        acceptanceCriteria: Array.isArray(raw.acceptanceCriteria)
          ? raw.acceptanceCriteria.map((value) => intakeText(value, 1_000)).filter(Boolean).join("\n")
          : intakeText(raw.acceptanceCriteria, 6_000),
        evidenceRequired: intakeText(raw.evidenceRequired, 4_000),
        definitionOfDone: intakeText(raw.definitionOfDone, 4_000),
        githubRepo,
        scoreRelevant: false,
      });
      if (itemType === "deliverable") {
        Object.assign(preview, {
          priority: intakePriority(raw.priority),
          workstream: intakeText(raw.workstream, 120),
          startDate,
          endDate,
          deadline: intakeText(raw.deadline, 120),
          hours: intakeHours(raw.hours),
        });
      }
    }
    if (githubSync) preview.githubSync = githubSync;
    return preview;
  });
}

export function planningItemCreateCommitItem(item: PlanningItemCreatePreviewItem) {
  const result = { ...item } as Partial<PlanningItemCreatePreviewItem>;
  delete result.errors;
  delete result.warnings;
  delete result.githubSync;
  return result;
}

export function planningItemCreateHash(
  items: PlanningItemCreatePreviewItem[],
  githubSyncMode: TeamPlanningItemGitHubSyncMode | null = null,
  githubSyncCommands: Array<PlanningItemGitHubSyncCommand | null> = [],
) {
  const committedItems = items.map(planningItemCreateCommitItem);
  const hashInput = githubSyncMode || githubSyncCommands.some(Boolean)
    ? { items: committedItems, githubSyncMode, githubSyncCommands }
    : committedItems;
  return createHash("sha256").update(JSON.stringify(hashInput), "utf8").digest("hex");
}

export function planningItemCreateGitHubSyncCommands(items: PlanningItemCreateInput[]) {
  return items.map((item) => {
    const itemType = itemTypeForInput(item.itemType).itemType;
    return itemType && !isStrategicPlanningItemType(itemType) && Object.hasOwn(item, "githubSync")
      ? item.githubSync as PlanningItemGitHubSyncCommand
      : null;
  });
}

type CreateResponseItem = {
  itemType: TeamPlanningItemType;
  item: Record<string, unknown>;
  githubSync?: PlanningItemGitHubSyncResult;
};

export type PlanningCreateTransaction = {
  batchId: string;
  replayed?: boolean;
  items: CreateResponseItem[];
  projectionOperationId?: string;
};

type StoredCreateRequest = {
  id: string;
  request_hash: string;
  response_tasks: CreateResponseItem[];
  contract_version: number | null;
};

type PlanningCreateState = Readonly<{
  preview: readonly PlanningItemCreatePreviewItem[];
  requestHash: string;
  githubSyncCommands: readonly (PlanningItemGitHubSyncCommand | null)[];
}>;

type PlanningCreateCommitPlan = PlanningCreateState;

type PlanningCreateSupabase = SupabaseServer;

type TeamCreateDependencies = Readonly<{
  supabase: PlanningCreateSupabase;
  actor: ActorContext;
  tokenId: string;
  rawItems: readonly PlanningItemCreateInput[];
  githubSyncMode: TeamPlanningItemGitHubSyncMode | null;
  scheduleAfter?: (callback: () => Promise<void>) => void;
  dispatchGitHubProjections?: (
    supabase: PlanningCreateSupabase,
    operationId: string,
  ) => Promise<Map<string, PlanningItemGitHubSyncResult>>;
  onPreview?: (items: readonly PlanningItemCreatePreviewItem[]) => void;
}>; 

function invalidCreate(reason: string, path = "command.items"): PlanningError {
  return { code: "invalidCommand", issues: [{ path, reason }] };
}

function providerErrorMessage(error: unknown) {
  return error && typeof error === "object" && "message" in error ? String(error.message || "") : "";
}

function createBrief(raw: PlanningItemCreateInput) {
  return {
    description: intakeText(raw.description, 4_000),
    problemStatement: intakeText(raw.problemStatement, 4_000),
    intendedOutcome: intakeText(raw.intendedOutcome, 4_000),
    scopeConstraints: intakeText(raw.scopeConstraints, 4_000),
    acceptanceCriteria: Array.isArray(raw.acceptanceCriteria)
      ? raw.acceptanceCriteria.map((value) => intakeText(value, 1_000)).filter(Boolean).join("\n")
      : intakeText(raw.acceptanceCriteria, 6_000),
    evidenceRequired: intakeText(raw.evidenceRequired, 4_000),
    definitionOfDone: intakeText(raw.definitionOfDone, 4_000),
  };
}

/** Transport aliases are normalized before the public PlanningItems seam. */
export function planningItemCreateCommand(items: readonly PlanningItemCreateInput[], actorProfileId: string): CreateItems {
  return {
    kind: "createItems",
    items: items.map((raw): NewPlanningItem => {
      const type = itemTypeForInput(raw.itemType);
      const kind = type.itemType || "deliverable";
      const title = intakeText(raw.title, 240);
      const ownerId = intakeText(raw.ownerId, 120) || (kind === "sub_issue" ? actorProfileId : "") || null;
      const statusErrors: string[] = [];
      const status = normalizedStatus(kind, raw.status, statusErrors);
      if (kind === "epic") return {
        kind,
        title,
        ownerId,
        description: intakeText(raw.description, 4_000),
        status: status as Extract<NewPlanningItem, { kind: "epic" }>["status"],
        targetDate: intakeDate(raw.targetDate) || null,
      };
      if (kind === "initiative") return {
        kind,
        title,
        ownerId,
        description: intakeText(raw.description, 4_000),
        status: status as Extract<NewPlanningItem, { kind: "initiative" }>["status"],
        parentId: intakeText(raw.parentTaskId, 120) || null,
        strategy: {
          goal: intakeText(raw.intendedOutcome, 4_000) || intakeText(raw.description, 4_000),
          successCriteria: Array.isArray(raw.acceptanceCriteria)
            ? raw.acceptanceCriteria.map((value) => intakeText(value, 1_000)).filter(Boolean).join("\n")
            : intakeText(raw.acceptanceCriteria, 6_000),
          scopeConstraints: intakeText(raw.scopeConstraints, 4_000),
        },
        raciAssignments: [
          ...(intakeText(raw.accountableProfileId, 120) ? [{ profileId: intakeText(raw.accountableProfileId, 120), role: "accountable" as const, sortOrder: 0 }] : []),
          ...normalizedTextList(raw.responsibleProfileIds).map((profileId, sortOrder) => ({ profileId, role: "responsible" as const, sortOrder })),
          ...normalizedTextList(raw.consultedProfileIds).map((profileId, sortOrder) => ({ profileId, role: "consulted" as const, sortOrder })),
          ...normalizedTextList(raw.informedProfileIds).map((profileId, sortOrder) => ({ profileId, role: "informed" as const, sortOrder })),
        ],
        priority: intakePriority(raw.priority),
        targetDate: intakeDate(raw.targetDate) || null,
      };
      if (kind === "sub_issue") return {
        kind,
        title,
        ownerId,
        brief: createBrief(raw),
        status: status as Extract<NewPlanningItem, { kind: "sub_issue" }>["status"],
        parentId: intakeText(raw.parentTaskId, 120),
        githubRepository: intakeText(raw.githubRepo, 120) || defaultGitHubRepository,
      };
      return {
        kind,
        title,
        ownerId,
        brief: createBrief(raw),
        status: status as Extract<NewPlanningItem, { kind: "deliverable" }>["status"],
        parentId: intakeText(raw.parentTaskId, 120) || null,
        priority: intakePriority(raw.priority),
        workstream: intakeText(raw.workstream, 120),
        startDate: intakeDate(raw.startDate) || null,
        endDate: intakeDate(raw.endDate) || null,
        deadline: intakeDate(raw.deadline) || null,
        hours: intakeHours(raw.hours),
        githubRepository: intakeText(raw.githubRepo, 120) || defaultGitHubRepository,
      };
    }),
  };
}

function transactionChange(transaction: PlanningCreateTransaction) {
  return { field: "createItemsTransaction", before: null, after: transaction } as const;
}

function transactionFromResult(result: Extract<PlanningResult, { ok: true }>): PlanningCreateTransaction | null {
  const value = result.changes.find((change) => change.field === "createItemsTransaction")?.after;
  return value && typeof value === "object" && !Array.isArray(value) ? value as PlanningCreateTransaction : null;
}

function mergeSyncResults(
  items: CreateResponseItem[],
  commands: readonly (PlanningItemGitHubSyncCommand | null)[],
  results: Map<string, PlanningItemGitHubSyncResult>,
) {
  return items.map((entry, index) => {
    if (!commands[index]) return entry;
    const result = results.get(String(entry.item?.id || ""));
    return result ? { ...entry, githubSync: result } : entry;
  });
}

function createEffects(preview: readonly PlanningItemCreatePreviewItem[]) {
  return [
    { kind: "activity" as const, description: `Record creation activity for ${preview.length} planning item(s)` },
    { kind: "audit" as const, description: "Record the planning create audit event" },
    ...(preview.some((item) => item.githubSync) ? [{ kind: "githubProjection" as const, description: "Project accepted planning items to GitHub" }] : []),
  ];
}

const planningCreateDecisionCore: PlanningDecisionCore<PlanningCreateState, PlanningCreateCommitPlan> = {
  decide({ command, state }) {
    if (command.kind !== "createItems") return { ok: false, error: invalidCreate("createItemsRequired", "command.kind") };
    if (command.items.length < 1 || command.items.length > TEAM_PLANNING_ITEMS_MAX_BATCH_SIZE) {
      return { ok: false, error: invalidCreate("batchSize") };
    }
    const issues = state.preview.flatMap((item, index) => item.errors.map((reason) => ({ path: `command.items.${index}`, reason })));
    if (issues.length) return { ok: false, error: { code: "invalidCommand", issues } };
    return {
      ok: true,
      items: [],
      changes: [{ field: "createItemsPreview", before: null, after: state.preview }],
      effects: createEffects(state.preview),
      warnings: state.preview.flatMap((item) => item.warnings.map((message) => ({ code: "createWarning", message }))),
      commitPlan: state,
    };
  },
};

function replayReceipt(transaction: PlanningCreateTransaction) {
  return {
    items: [],
    changes: [transactionChange({ ...transaction, replayed: true })],
    effects: [],
    replayed: true,
  };
}

async function prepareTeamCreate(
  dependencies: TeamCreateDependencies,
  request: PlanningPreparationRequest,
): Promise<{ data: PlanningPreparation<PlanningCreateState> | null; error: unknown | null }> {
  if (request.command.kind !== "createItems") return { data: { kind: "error", error: invalidCreate("createItemsRequired", "command.kind") }, error: null };
  let stored: StoredCreateRequest | null = null;
  if (request.idempotencyKey) {
    const existingRequest = await dependencies.supabase
      .from("team_task_intake_batches")
      .select("id,request_hash,response_tasks,contract_version")
      .eq("token_id", dependencies.tokenId)
      .eq("idempotency_key", request.idempotencyKey)
      .maybeSingle();
    if (existingRequest.error) return { data: null, error: existingRequest.error };
    stored = existingRequest.data as StoredCreateRequest | null;
  }
  if (stored && Number(stored.contract_version || 1) < 2) {
    return { data: { kind: "error", error: { code: "conflict", reason: "idempotency" } }, error: null };
  }
  const preview = await buildPlanningItemCreatePreview([...dependencies.rawItems], {
    id: request.actor.profileId,
    platformRole: request.actor.platformRole,
  } as AuthenticatedProfile, dependencies.supabase);
  dependencies.onPreview?.(preview);
  const githubSyncCommands = planningItemCreateGitHubSyncCommands([...dependencies.rawItems]);
  const requestHash = planningItemCreateHash(preview, dependencies.githubSyncMode, githubSyncCommands);
  if (stored) {
    if (requestHash !== stored.request_hash) {
      return { data: { kind: "error", error: { code: "conflict", reason: "idempotency" } }, error: null };
    }
    let replayItems = stored.response_tasks;
    if (dependencies.githubSyncMode === "wait" && dependencies.dispatchGitHubProjections && request.idempotencyKey) {
      await dependencies.dispatchGitHubProjections(
        dependencies.supabase,
        `team-create:${dependencies.tokenId}:${request.idempotencyKey}`,
      );
      const refreshed = await dependencies.supabase
        .from("team_task_intake_batches")
        .select("response_tasks")
        .eq("token_id", dependencies.tokenId)
        .eq("idempotency_key", request.idempotencyKey)
        .single();
      if (refreshed.error) return { data: null, error: refreshed.error };
      replayItems = (refreshed.data as { response_tasks: CreateResponseItem[] }).response_tasks;
    }
    return { data: { kind: "replay", receipt: replayReceipt({ batchId: stored.id, items: replayItems, replayed: true }) }, error: null };
  }
  return { data: { kind: "state", state: { preview, requestHash, githubSyncCommands } }, error: null };
}

function createProviderError(error: unknown): PlanningError {
  const code = error && typeof error === "object" && "code" in error ? String(error.code || "") : "";
  if (code === "P0003") return { code: "conflict", reason: "idempotency" };
  if (["P0014", "P0015"].includes(code)) return { code: "conflict", reason: "state" };
  if (code === "P0004") return { code: "forbidden", reason: "planningTokenInactive" };
  if (["P0005", "P0006", "P0007"].includes(code)) return { code: "forbidden", reason: "planningTokenRejected" };
  if (code === "22023") return invalidCreate("persistenceValidation");
  if (["PGRST202", "42P01", "42703", "42883"].includes(code)) return { code: "dependencyUnavailable", dependency: "database", retryable: false };
  return { code: "dependencyUnavailable", dependency: "database", retryable: true };
}

async function commitTeamCreate(
  dependencies: TeamCreateDependencies,
  request: PlanningCommitRequest<PlanningCreateCommitPlan>,
): Promise<{ data: PlanningCommitOutcome | null; error: unknown | null }> {
  const metadata = request.requestMetadata;
  const { data, error } = await dependencies.supabase.rpc("create_team_planning_items_with_projection_transaction", {
    p_token_id: dependencies.tokenId,
    p_profile_id: request.actor.profileId,
    p_idempotency_key: request.idempotencyKey,
    p_request_hash: request.plan.requestHash,
    p_items: request.plan.preview.map(planningItemCreateCommitItem),
    p_projection_commands: request.plan.githubSyncCommands,
    p_request_ip: metadata?.requestIp || null,
    p_user_agent: metadata?.userAgent || null,
  });
  if (error) return { data: { ok: false, error: createProviderError(error) }, error: null };
  const transaction = data as PlanningCreateTransaction | null;
  if (!transaction?.batchId || !Array.isArray(transaction.items)) {
    return { data: { ok: false, error: { code: "dependencyUnavailable", dependency: "database", retryable: false } }, error: null };
  }
  if (!dependencies.githubSyncMode || !transaction.projectionOperationId) {
    return { data: {
      ok: true,
      receipt: {
        items: [], changes: [transactionChange(transaction)],
        effects: createEffects(request.plan.preview).map((effect) => ({ ...effect, status: effect.kind === "githubProjection" ? "queued" as const : "applied" as const })),
        replayed: Boolean(transaction.replayed),
      },
    }, error: null };
  }
  if (dependencies.githubSyncMode === "wait") {
    if (!dependencies.dispatchGitHubProjections) return { data: { ok: false, error: { code: "dependencyUnavailable", dependency: "github", retryable: true } }, error: null };
    const results = await dependencies.dispatchGitHubProjections(dependencies.supabase, transaction.projectionOperationId);
    transaction.items = mergeSyncResults(transaction.items, request.plan.githubSyncCommands, results);
  } else {
    if (dependencies.scheduleAfter && dependencies.dispatchGitHubProjections) {
      dependencies.scheduleAfter(async () => {
        await dependencies.dispatchGitHubProjections!(dependencies.supabase, transaction.projectionOperationId!);
      });
    }
  }
  return { data: {
    ok: true,
    receipt: {
      items: [], changes: [transactionChange(transaction)],
      effects: createEffects(request.plan.preview).map((effect) => ({ ...effect, status: effect.kind === "githubProjection" ? "queued" as const : "applied" as const })),
      replayed: false,
    },
  }, error: null };
}

export function createTeamCreatePlanningItems(dependencies: TeamCreateDependencies): PlanningItems {
  return {
    async run(invocation) {
      if (dependencies.actor.profileId !== invocation.actor.profileId) return { ok: false, error: { code: "forbidden", reason: "actorMismatch" } };
      if (invocation.actor.credential.kind === "planningToken" && invocation.mode === "commit" && !invocation.idempotencyKey) {
        return { ok: false, error: invalidCreate("idempotencyKeyRequired", "idempotencyKey") };
      }
      const preparation = await prepareTeamCreate(dependencies, {
        actor: invocation.actor,
        command: invocation.command,
        ...(invocation.mode === "commit" && invocation.idempotencyKey
          ? { idempotencyKey: invocation.idempotencyKey }
          : {}),
      });
      if (preparation.error || !preparation.data) return { ok: false, error: { code: "dependencyUnavailable", dependency: "database", retryable: true } };
      if (preparation.data.kind === "error") return { ok: false, error: preparation.data.error };
      if (preparation.data.kind === "replay") return {
        ok: true,
        status: "committed",
        items: preparation.data.receipt.items,
        changes: preparation.data.receipt.changes,
        effects: preparation.data.receipt.effects,
        replayed: true,
      };
      const decision = planningCreateDecisionCore.decide({ actor: invocation.actor, command: invocation.command, state: preparation.data.state });
      if (!decision.ok) return { ok: false, error: decision.error };
      if (invocation.mode === "preview") return {
        ok: true,
        status: "previewed",
        items: decision.items,
        changes: decision.changes,
        effects: decision.effects,
        warnings: decision.warnings,
      };
      const committed = await commitTeamCreate(dependencies, {
        actor: invocation.actor,
        command: invocation.command,
        plan: decision.commitPlan,
        idempotencyKey: invocation.idempotencyKey,
        requestMetadata: invocation.requestMetadata,
      });
      if (committed.error || !committed.data) return { ok: false, error: { code: "dependencyUnavailable", dependency: "database", retryable: true } };
      return committed.data.ok ? {
        ok: true,
        status: "committed",
        items: committed.data.receipt.items,
        changes: committed.data.receipt.changes,
        effects: committed.data.receipt.effects,
        replayed: committed.data.receipt.replayed,
      } : committed.data;
    },
  };
}

export function planningCreateTransactionFromResult(result: Extract<PlanningResult, { ok: true }>) {
  return transactionFromResult(result);
}

export function planningCreateError(error: PlanningError) {
  if (error.code === "conflict" && error.reason === "idempotency") return { message: "Idempotency-Key wurde mit anderen Daten wiederverwendet.", status: 409 };
  if (error.code === "conflict" && error.reason === "state") return { message: "GitHub-Sync ist für mindestens ein Planungselement im aktuellen Zustand nicht möglich.", status: 409 };
  if (error.code === "forbidden") return error.reason === "planningTokenInactive"
    ? { message: "Planning-API-Token ist nicht mehr aktiv.", status: 401 }
    : { message: "Planning-API-Berechtigung ist nicht mehr gültig.", status: 403 };
  if (error.code === "invalidCommand") {
    const validationIssues = error.issues.filter((issue) => /^command\.items\.\d+$/.test(issue.path));
    return validationIssues.length
      ? { message: "Planning-Items-Erstellung enthält ungültige Einträge.", status: 400, issues: validationIssues }
      : { message: "Planning-Items-Anfrage ist ungültig.", status: 400 };
  }
  if (error.code === "dependencyUnavailable" && error.dependency === "database" && !error.retryable) {
    return { message: "Planning-API-Schema ist noch nicht verfügbar.", status: 503 };
  }
  return { message: "Planning-Items-Erstellung konnte nicht gespeichert werden.", status: 500 };
}

export function planningCreateTokenBecameInactive(error: PlanningError) {
  return error.code === "forbidden" && error.reason === "planningTokenInactive";
}

export type BrowserCreateWriter =
  | Readonly<{
    kind: "strategic";
    params: Readonly<{
      item: Record<string, unknown>;
      strategy: Record<string, unknown> | null;
      raciAssignments: readonly Record<string, unknown>[];
    }>;
  }>
  | Readonly<{
    kind: "delivery";
    params: Readonly<{
      taskInsert: Record<string, unknown>;
      relationType: string | null;
      relatedTaskId: string | null;
      relationNote: string | null;
      activityMessage: string;
      relationActivityMessage: string | null;
      notifications: readonly Record<string, unknown>[];
      approveNow: boolean;
    }>;
  }>;

type BrowserCreateDependencies = Readonly<{
  supabase: SupabaseServer;
  actor: ActorContext;
  writer: BrowserCreateWriter;
}>;

function previewFromCommand(command: CreateItems): PlanningItemCreatePreviewItem[] {
  return command.items.map((item, index) => ({
    clientId: `browser-create-${index + 1}`,
    itemType: item.kind,
    title: item.title,
    description: "description" in item ? item.description : item.brief.description,
    ownerId: item.ownerId || "",
    parentTaskId: "parentId" in item ? item.parentId || "" : "",
    status: item.status,
    approvalStatus: item.kind === "initiative" || item.kind === "deliverable" ? "proposed" : null,
    errors: [],
    warnings: [],
  }));
}

export function createBrowserCreatePlanningItems(dependencies: BrowserCreateDependencies): PlanningItems {
  return {
    async run(invocation) {
      if (dependencies.actor.profileId !== invocation.actor.profileId) return { ok: false, error: { code: "forbidden", reason: "actorMismatch" } };
      if (invocation.command.kind !== "createItems") return { ok: false, error: invalidCreate("createItemsRequired", "command.kind") };
      const state: PlanningCreateState = {
        preview: previewFromCommand(invocation.command),
        requestHash: "browser-session",
        githubSyncCommands: [],
      };
      const decision = planningCreateDecisionCore.decide({ actor: invocation.actor, command: invocation.command, state });
      if (!decision.ok) return { ok: false, error: decision.error };
      if (invocation.mode === "preview") return {
        ok: true,
        status: "previewed",
        items: decision.items,
        changes: decision.changes,
        effects: decision.effects,
        warnings: decision.warnings,
      };
      const metadata = invocation.requestMetadata;
      const writer = dependencies.writer;
      const result = writer.kind === "strategic"
        ? await dependencies.supabase.rpc("create_browser_planning_item_transaction", {
          p_item: writer.params.item,
          p_strategy: writer.params.strategy,
          p_raci_assignments: writer.params.raciAssignments,
          p_actor_profile_id: invocation.actor.profileId,
          p_request_ip: metadata?.requestIp || null,
          p_user_agent: metadata?.userAgent || null,
        })
        : await dependencies.supabase.rpc("create_planning_task_transaction", {
          p_task_insert: writer.params.taskInsert,
          p_relation_type: writer.params.relationType,
          p_related_task_id: writer.params.relatedTaskId,
          p_relation_note: writer.params.relationNote,
          p_activity_message: writer.params.activityMessage,
          p_relation_activity_message: writer.params.relationActivityMessage,
          p_notifications: writer.params.notifications,
          p_actor_profile_id: invocation.actor.profileId,
          p_request_ip: metadata?.requestIp || null,
          p_user_agent: metadata?.userAgent || null,
          p_approve_now: writer.params.approveNow,
        });
      if (result.error) {
        const provider = result.error as { code?: string };
        const providerMessage = providerErrorMessage(result.error);
        if (provider.code === "P0006") return { ok: false, error: { code: "forbidden", reason: "createRequiresOperationalLead" } };
        if (provider.code === "23503" && providerMessage.includes("RACI")) return { ok: false, error: invalidCreate("raciProfileNotFound") };
        if (provider.code === "23505" && providerMessage.includes("RACI")) return { ok: false, error: invalidCreate("raciAssignmentDuplicated") };
        if (provider.code === "P0003" || provider.code === "23505") return { ok: false, error: { code: "conflict", reason: provider.code === "P0003" ? "idempotency" : "state" } };
        if (provider.code === "P0002") return { ok: false, error: { code: "notFound", entity: { kind: "relationship", id: writer.kind === "delivery" ? writer.params.relatedTaskId || "" : "" } } };
        if (provider.code === "22023" || provider.code === "23514") return { ok: false, error: invalidCreate("persistenceValidation") };
        return { ok: false, error: { code: "dependencyUnavailable", dependency: "database", retryable: true } };
      }
      return {
        ok: true,
        status: "committed",
        items: [],
        changes: [{ field: "browserCreateTransaction", before: null, after: result.data }],
        effects: createEffects(state.preview).map((effect) => ({ ...effect, status: "applied" as const })),
        replayed: Boolean((result.data as { replayed?: boolean } | null)?.replayed),
      };
    },
  };
}

export function browserCreateTransactionFromResult(result: Extract<PlanningResult, { ok: true }>) {
  return result.changes.find((change) => change.field === "browserCreateTransaction")?.after;
}
