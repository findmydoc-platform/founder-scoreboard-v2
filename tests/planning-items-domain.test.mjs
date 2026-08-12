import assert from "node:assert/strict";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

const domain = await loadTranspiledModule(
  "src/features/planning-items/model/planning-item-domain.ts",
);
const actors = await loadTranspiledModule(
  "src/features/planning-items/model/planning-actor-context-server.ts",
  {
    "server-only": {},
    "./actor-context": await loadTranspiledModule(
      "src/features/planning-items/model/actor-context.ts",
    ),
  },
);

test("planning item kinds expose only their existing status sets", () => {
  assert.equal(domain.isPlanningItemStatus("epic", "Pausiert"), true);
  assert.equal(domain.isPlanningItemStatus("initiative", "Review"), false);
  assert.equal(domain.isPlanningItemStatus("deliverable", "Review"), true);
  assert.equal(domain.isPlanningItemStatus("deliverable", "Pausiert"), false);
  assert.equal(domain.isPlanningItemStatus("sub_issue", "Erledigt"), true);
  assert.equal(domain.isPlanningItemStatus("sub_issue", "Nacharbeit"), false);
});

test("planning item parent rules encode the four-level hierarchy", () => {
  assert.equal(domain.isPlanningParentAllowed("epic", null), true);
  assert.equal(domain.isPlanningParentAllowed("epic", "initiative"), false);
  assert.equal(domain.isPlanningParentAllowed("initiative", null), true);
  assert.equal(domain.isPlanningParentAllowed("initiative", "epic"), true);
  assert.equal(domain.isPlanningParentAllowed("deliverable", null), true);
  assert.equal(domain.isPlanningParentAllowed("deliverable", "initiative"), true);
  assert.equal(domain.isPlanningParentAllowed("sub_issue", null), false);
  assert.equal(domain.isPlanningParentAllowed("sub_issue", "deliverable"), true);
});

test("kind-specific capabilities stay separate", () => {
  for (const kind of domain.PLANNING_ITEM_KINDS) {
    assert.equal(domain.supportsPlanningApproval(kind), ["initiative", "deliverable"].includes(kind));
    assert.equal(domain.supportsPlanningRaci(kind), kind === "initiative");
    assert.equal(domain.supportsPlanningReview(kind), kind === "deliverable");
    assert.equal(domain.supportsPlanningSprint(kind), kind === "deliverable");
    assert.equal(domain.supportsGitHubProjection(kind), ["deliverable", "sub_issue"].includes(kind));
  }
});

test("trusted server adapters create the three actor credential variants", () => {
  assert.deepEqual(
    actors.actorContextFromSessionAuth({
      ok: true,
      profile: { id: "profile-1", platformRole: "founder", name: "Ignored" },
    }),
    {
      ok: true,
      actor: {
        profileId: "profile-1",
        platformRole: "founder",
        credential: { kind: "session" },
      },
    },
  );

  assert.deepEqual(
    actors.actorContextFromPlanningTokenAuth({
      ok: true,
      profile: { id: "profile-2", platformRole: "deputy" },
      tokenId: "token-1",
      scopes: ["read:planning-context", "write:planning-items:update"],
      canApprove: true,
    }),
    {
      ok: true,
      actor: {
        profileId: "profile-2",
        platformRole: "deputy",
        credential: {
          kind: "planningToken",
          tokenId: "token-1",
          scopes: ["read:planning-context", "write:planning-items:update"],
        },
      },
    },
  );

  assert.deepEqual(
    actors.actorContextFromLocalDevelopmentProfile({ id: "profile-3", platformRole: "ceo" }),
    {
      ok: true,
      actor: {
        profileId: "profile-3",
        platformRole: "ceo",
        credential: { kind: "localDevelopment" },
      },
    },
  );
});

test("actor adapters fail closed and ignore caller capability metadata", () => {
  assert.deepEqual(
    actors.actorContextFromSessionAuth({ ok: false, profile: { id: "injected", platformRole: "ceo" } }),
    { ok: false, reason: "authenticationRejected" },
  );
  assert.deepEqual(
    actors.actorContextFromSessionAuth({ ok: true, profile: null }),
    { ok: false, reason: "profileMissing" },
  );
  assert.deepEqual(
    actors.actorContextFromLocalDevelopmentProfile({ id: "", platformRole: "ceo" }),
    { ok: false, reason: "invalidProfile" },
  );
  assert.deepEqual(
    actors.actorContextFromPlanningTokenAuth({
      ok: true,
      profile: { id: "profile-2", platformRole: "founder" },
      tokenId: "token-1",
      scopes: ["write:anything"],
    }),
    { ok: false, reason: "invalidCredential" },
  );
});
