import { afterEach, expect, test, vi } from "vitest";
import { createPlanningState, type PlanningStateAdapter } from "@/features/planning/model/internal/planning-state-owner";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import type { PlatformReleaseReferenceEntry, PlatformReleaseReferenceKey, PlatformReleaseReferenceReceipt } from "@/features/platform-releases/model/platform-release-model";

const profile = { id: "release-profile", name: "Release reader", githubLogin: "", platformRole: "viewer" } as const;
const release = { version: "v1.2.3", manifestDigest: "previous-manifest" };
const replacement = { ...release, manifestDigest: "new-manifest" };
const owned: ReturnType<typeof createPlanningState>[] = [];
afterEach(() => owned.splice(0).forEach(owner => owner.internal.dispose()));

function owner(readPlatformReleaseReferences: NonNullable<PlanningStateAdapter["readPlatformReleaseReferences"]>) {
  const current = createPlanningState({ userId: "reader", initialCurrentProfile: profile, initialData: emptyPlanningShellState,
    adapter: { saveTask: async () => ({ task: {} }), readWorkspace: async () => null, readPlatformReleaseReferences } });
  owned.push(current);
  return current;
}

function receipt(key: PlatformReleaseReferenceKey): PlatformReleaseReferenceReceipt {
  return {
    ...key, sourceRevision: "source-2",
    readActor: { profileId: profile.id, platformRole: profile.platformRole },
    readAuthority: { userId: "reader", deadline: Date.now() + 30_000 },
    planningReferences: [],
  };
}

test("only the active manifest can accept Planning references, even when older results arrive later", async () => {
  let resolveOld!: (receipt: PlatformReleaseReferenceReceipt) => void;
  let oldSignal: AbortSignal | undefined;
  const { planning } = owner((key, signal) => {
    if (key.manifestDigest === release.manifestDigest) {
      oldSignal = signal;
      return new Promise(resolve => { resolveOld = resolve; });
    }
    return Promise.resolve(receipt(key));
  });
  const previous = planning.loadReleasePlanningReferences(release);
  expect(planning.releasePlanningReferences(release)).toEqual({ status: "loading" });
  await expect(planning.loadReleasePlanningReferences(replacement)).resolves.toBe(true);
  expect(oldSignal?.aborted).toBe(true);
  resolveOld(receipt(release));
  await expect(previous).resolves.toBe(false);
  expect(planning.releasePlanningReferences(release)).toEqual({ status: "not-loaded" });
  expect(planning.releasePlanningReferences(replacement)).toEqual({ status: "ready", planningReferences: [] });
});

test("reference failure remains unknown, retries independently, and only an authorized receipt establishes emptiness", async () => {
  const read = vi.fn<NonNullable<PlanningStateAdapter["readPlatformReleaseReferences"]>>()
    .mockRejectedValueOnce(Object.assign(new Error("Matching temporarily unavailable"), { status: 503 }))
    .mockResolvedValueOnce({ ...receipt(release), readActor: { profileId: "other", platformRole: "viewer" } })
    .mockResolvedValue(receipt(release));
  const { planning } = owner(read);
  await expect(planning.loadReleasePlanningReferences(release)).resolves.toBe(false);
  expect(planning.releasePlanningReferences(release)).toEqual({ status: "unavailable" });
  await expect(planning.loadReleasePlanningReferences(release)).resolves.toBe(false);
  expect(planning.releasePlanningReferences(release)).toEqual({ status: "unavailable" });
  await expect(planning.loadReleasePlanningReferences(release)).resolves.toBe(true);
  expect(planning.releasePlanningReferences(release)).toEqual({ status: "ready", planningReferences: [] });
  expect(read).toHaveBeenCalledTimes(3);
});

test("session end aborts reference work and cannot reveal a late result", async () => {
  let finish!: (value: PlatformReleaseReferenceReceipt) => void;
  let activeSignal: AbortSignal | undefined;
  const { planning, internal } = owner((_key, signal) => {
    activeSignal = signal;
    return new Promise(resolve => { finish = resolve; });
  });
  const pending = planning.loadReleasePlanningReferences(release);
  internal.endSession();
  expect(activeSignal?.aborted).toBe(true);
  finish(receipt(release));
  await expect(pending).resolves.toBe(false);
  expect(planning.releasePlanningReferences(release)).toEqual({ status: "not-loaded" });
});

test("a release source observation reuses matching references and invalidates changed or denied ones", async () => {
  let revision = "source-2", forbidden = false, unavailable = false;
  const read = vi.fn(async (key: PlatformReleaseReferenceKey) => receipt(key));
  const observeReleasePlanningSource = vi.fn(async () => {
    if (forbidden) throw Object.assign(new Error("Scope denied"), { status: 403 });
    if (unavailable) throw Object.assign(new Error("Version unavailable"), { status: 503 });
    const { readActor, readAuthority } = receipt(release);
    return { readActor, readAuthority, sourceRevision: revision };
  });
  const current = createPlanningState({ userId: "reader", initialCurrentProfile: profile, initialData: emptyPlanningShellState,
    adapter: { saveTask: async () => ({ task: {} }), readWorkspace: async () => null, readPlatformReleaseReferences: read, observeReleasePlanningSource } });
  owned.push(current);
  const { planning } = current;
  await planning.loadReleasePlanningReferences(release);
  await planning.checkReleasePlanningReferences(release);
  expect(planning.releasePlanningReferences(release).status).toBe("ready");
  unavailable = true;
  await planning.checkReleasePlanningReferences(release);
  expect(planning.releasePlanningReferences(release).status).toBe("ready");
  expect(read).toHaveBeenCalledTimes(1);
  unavailable = false;
  revision = "source-3";
  await planning.checkReleasePlanningReferences(release);
  expect(planning.releasePlanningReferences(release)).toEqual({ status: "not-loaded" });
  await planning.loadReleasePlanningReferences(release);
  forbidden = true;
  await planning.checkReleasePlanningReferences(release);
  expect(planning.releasePlanningReferences(release)).toEqual({ status: "forbidden" });
  expect(read).toHaveBeenCalledTimes(2);
  expect(observeReleasePlanningSource).toHaveBeenCalledTimes(4);
});

function streamedOwner(readPlatformReleaseReferences = vi.fn(async (key: PlatformReleaseReferenceKey) => receipt(key)), timeoutIn = 10_000) {
  const session = { userId: "reader", user: { id: "reader" }, revision: "session-1", expiresAt: Math.floor(Date.now() / 1_000) + 60 };
  const { readActor, readAuthority } = receipt(release);
  const descriptor: PlatformReleaseReferenceEntry = { id: "entry", key: release, session, readActor, readAuthority, timeoutAt: Date.now() + timeoutIn };
  const result = createPlanningState({ userId: "reader", initialCurrentProfile: profile, initialData: emptyPlanningShellState,
    initialSession: session, initialReleaseReferenceEntry: descriptor,
    adapter: { saveTask: async () => ({ task: {} }), readWorkspace: async () => null, readPlatformReleaseReferences } });
  owned.push(result);
  return { ...result, descriptor, readPlatformReleaseReferences };
}

test("document delivery satisfies the first release demand once without a duplicate browser read", async () => {
  const { planning, descriptor, readPlatformReleaseReferences } = streamedOwner();
  expect(planning.releasePlanningReferences(release)).toEqual({ status: "loading" });
  const demand = planning.loadReleasePlanningReferences(release);
  const current = { ...receipt(release), readAuthority: descriptor.readAuthority };
  expect(planning.acceptReleaseReferenceEntry(descriptor.id, { status: "ready", receipt: current })).toBe(true);
  await expect(demand).resolves.toBe(true);
  expect(planning.releasePlanningReferences(release)).toEqual({ status: "ready", planningReferences: [] });
  expect(planning.acceptReleaseReferenceEntry(descriptor.id, { status: "forbidden" })).toBe(false);
  expect(readPlatformReleaseReferences).not.toHaveBeenCalled();
});

test("an unavailable document result waits for a targeted retry and does not establish empty references", async () => {
  const { planning, descriptor, readPlatformReleaseReferences } = streamedOwner();
  const demand = planning.loadReleasePlanningReferences(release);
  expect(planning.acceptReleaseReferenceEntry(descriptor.id, { status: "unavailable" })).toBe(false);
  await expect(demand).resolves.toBe(false);
  expect(planning.releasePlanningReferences(release)).toEqual({ status: "unavailable" });
  await planning.checkReleasePlanningReferences(release);
  expect(readPlatformReleaseReferences).not.toHaveBeenCalled();
  await expect(planning.loadReleasePlanningReferences(release)).resolves.toBe(true);
  expect(readPlatformReleaseReferences).toHaveBeenCalledOnce();
});

test("a document receipt cannot extend the original authority or arrive after its timeout", async () => {
  vi.useFakeTimers();
  try {
    const first = streamedOwner();
    const longer = { ...first.descriptor.readAuthority, deadline: first.descriptor.readAuthority.deadline + 1 };
    expect(first.planning.acceptReleaseReferenceEntry(first.descriptor.id, { status: "ready", receipt: { ...receipt(release), readAuthority: longer } })).toBe(false);
    expect(first.planning.releasePlanningReferences(release)).toEqual({ status: "unavailable" });
    const pending = streamedOwner(undefined, 50);
    pending.internal.watchServerHeaderRead();
    await vi.advanceTimersByTimeAsync(51);
    expect(pending.planning.releasePlanningReferences(release)).toEqual({ status: "unavailable" });
    expect(pending.planning.acceptReleaseReferenceEntry(pending.descriptor.id, { status: "ready", receipt: receipt(release) })).toBe(false);
    expect(pending.readPlatformReleaseReferences).not.toHaveBeenCalled();
  } finally { vi.useRealTimers(); }
});

test("an abandoned document cannot replace a newly requested manifest", async () => {
  const { planning, descriptor } = streamedOwner();
  const demand = planning.loadReleasePlanningReferences(release);
  planning.cancelReleaseReferenceEntry(descriptor.id);
  await expect(demand).resolves.toBe(false);
  await expect(planning.loadReleasePlanningReferences(replacement)).resolves.toBe(true);
  expect(planning.acceptReleaseReferenceEntry(descriptor.id, { status: "ready", receipt: receipt(release) })).toBe(false);
  expect(planning.releasePlanningReferences(replacement)).toEqual({ status: "ready", planningReferences: [] });
});

test("session replacement suppresses document delivery before it can expose protected links", async () => {
  const { planning, internal, descriptor } = streamedOwner();
  const demand = planning.loadReleasePlanningReferences(release);
  internal.bindSession({ ...descriptor.session, revision: "replaced-session" });
  await expect(demand).resolves.toBe(false);
  expect(planning.acceptReleaseReferenceEntry(descriptor.id, { status: "ready", receipt: { ...receipt(release), readAuthority: descriptor.readAuthority } })).toBe(false);
  expect(planning.releasePlanningReferences(release)).toEqual({ status: "not-loaded" });
});
