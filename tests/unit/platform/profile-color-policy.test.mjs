import assert from "node:assert/strict";
import { test } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";

const policy = await importTestModule(
  "src/features/profile/model/profile-color-policy.ts",
);
const api = await importTestModule(
  "src/features/profile/model/profile-color-api.ts",
  {
    "@/features/profile/model/profile-color-policy": policy,
  },
);

const expectedPalette = [
  { value: "#22c55e", label: "Mint" },
  { value: "#4f46e5", label: "Indigo" },
  { value: "#f97316", label: "Orange" },
  { value: "#ec4899", label: "Pink" },
  { value: "#06b6d4", label: "Cyan" },
  { value: "#ef4444", label: "Rot" },
  { value: "#84cc16", label: "Limette" },
  { value: "#8b5cf6", label: "Lila" },
  { value: "#f59e0b", label: "Gelb" },
  { value: "#1e3a8a", label: "Marine" },
  { value: "#14b8a6", label: "Türkis" },
  { value: "#c026d3", label: "Magenta" },
  { value: "#92400e", label: "Braun" },
  { value: "#e11d48", label: "Rose" },
  { value: "#3b82f6", label: "Blau" },
  { value: "#0f766e", label: "Petrol" },
  { value: "#64748b", label: "Schiefer" },
  { value: "#4d7c0f", label: "Oliv" },
  { value: "#701a75", label: "Aubergine" },
  { value: "#334155", label: "Anthrazit" },
];

test("profile colors expose exactly the fixed 20-color palette", () => {
  assert.deepEqual(policy.profileColorOptions, expectedPalette);
  assert.equal(new Set(policy.profileColorOptions.map((option) => option.value)).size, 20);
});

test("profile color picker keeps the own color available and blocks occupied colors while a color is free", () => {
  const model = policy.buildProfileColorPickerModel({
    currentColor: "#22c55e",
    currentProfileId: "self",
    profiles: [
      { id: "self", color: "#22c55e" },
      { id: "other", color: "#4f46e5" },
    ],
  });

  assert.equal(model.duplicateMode, false);
  assert.deepEqual(
    model.options.find((option) => option.value === "#22c55e"),
    {
      value: "#22c55e",
      label: "Mint",
      selected: true,
      disabled: false,
      status: "current",
      statusLabel: "Aktuell",
      ariaLabel: "Mint, aktuell ausgewählt",
    },
  );
  assert.equal(model.options.find((option) => option.value === "#4f46e5")?.status, "occupied");
  assert.equal(model.options.find((option) => option.value === "#4f46e5")?.disabled, true);
  assert.equal(model.options.find((option) => option.value === "#f97316")?.status, "free");
  assert.equal(model.options.find((option) => option.value === "#f97316")?.disabled, false);
});

test("profile color picker enables deliberate duplicates only when all colors are represented", () => {
  const profiles = expectedPalette.map((option, index) => ({
    id: index === 0 ? "self" : `profile-${index}`,
    color: option.value,
  }));
  const model = policy.buildProfileColorPickerModel({
    currentColor: expectedPalette[0].value,
    currentProfileId: "self",
    profiles,
  });

  assert.equal(model.duplicateMode, true);
  assert.equal(model.options.every((option) => !option.disabled), true);
  assert.equal(model.options.find((option) => option.value === expectedPalette[1].value)?.status, "reusable");
  assert.equal(model.options.find((option) => option.value === expectedPalette[1].value)?.statusLabel, "Mehrfach möglich");
});

test("an existing duplicate stays selectable after another palette color becomes free", () => {
  const profiles = expectedPalette.slice(0, -1).map((option, index) => ({
    id: index === 0 ? "self" : `profile-${index}`,
    color: option.value,
  }));
  profiles.push({ id: "duplicate", color: expectedPalette[0].value });

  const model = policy.buildProfileColorPickerModel({
    currentColor: expectedPalette[0].value,
    currentProfileId: "self",
    profiles,
  });

  assert.equal(model.duplicateMode, false);
  assert.equal(model.options[0].status, "current");
  assert.equal(model.options[0].disabled, false);
  assert.equal(model.options.at(-1).status, "free");
  assert.equal(model.options.at(-1).disabled, false);
  assert.equal(model.options[1].status, "occupied");
  assert.equal(model.options[1].disabled, true);
});

test("profile settings omit an unchanged color and send the observed mode only for a change", () => {
  assert.deepEqual(
    policy.buildProfileColorSavePatch({
      draftColor: "#22c55e",
      persistedColor: "#22c55e",
      duplicateMode: false,
    }),
    {},
  );
  assert.deepEqual(
    policy.buildProfileColorSavePatch({
      draftColor: "#3b82f6",
      persistedColor: "#22c55e",
      duplicateMode: true,
    }),
    { color: "#3b82f6", profileColorDuplicateMode: true },
  );
});

test("profile color conflict recovery preserves unrelated unsaved settings", () => {
  const draft = {
    color: "#3b82f6",
    focus: "Keep this new focus",
    notificationsEnabled: false,
  };

  assert.deepEqual(
    policy.restoreProfileColorAfterConflict(draft, "#22c55e"),
    {
      color: "#22c55e",
      focus: "Keep this new focus",
      notificationsEnabled: false,
    },
  );
});

test("profile color API adapter normalizes palette values and requires explicit duplicate intent", () => {
  assert.deepEqual(
    api.buildProfileColorPatch({ color: "  #3B82F6  ", profileColorDuplicateMode: false }),
    {
      ok: true,
      patch: {
        profile_color: "#3b82f6",
        profile_color_duplicate_mode: false,
      },
    },
  );
  assert.deepEqual(api.buildProfileColorPatch({}), { ok: true, patch: {} });
  assert.deepEqual(api.buildProfileColorPatch({ color: "#ffffff", profileColorDuplicateMode: false }), {
    ok: false,
    status: 400,
    error: "Ungültige Profilfarbe.",
  });
  assert.deepEqual(api.buildProfileColorPatch({ color: "#3b82f6" }), {
    ok: false,
    status: 400,
    error: "Der Farbmodus fehlt.",
  });
});

test("profile color API adapter maps database conflicts to a stable 409 and requests a refresh", () => {
  assert.deepEqual(api.mapProfileColorTransactionError({ code: "P0001" }), {
    status: 409,
    error: "Diese Profilfarbe ist nicht mehr verfügbar.",
  });
  assert.equal(api.mapProfileColorTransactionError({ code: "22023" }), null);
  assert.deepEqual(api.profileColorConflictFeedback(409), {
    message: "Diese Profilfarbe ist nicht mehr verfügbar.",
    refreshProfiles: true,
  });
  assert.equal(api.profileColorConflictFeedback(500), null);
});

test("profile color conflict recovery keeps the 409 visible when refresh fails", async () => {
  const refreshed = await api.recoverProfileColorConflict(async () => true);
  assert.equal(refreshed.name, "ProfileColorConflictError");
  assert.equal(
    refreshed.message,
    "Diese Profilfarbe ist nicht mehr verfügbar. Die Farbauswahl wurde aktualisiert.",
  );

  const unavailable = await api.recoverProfileColorConflict(async () => false);
  assert.equal(unavailable.name, "ProfileColorConflictError");
  assert.equal(
    unavailable.message,
    "Diese Profilfarbe ist nicht mehr verfügbar. Der aktuelle Farbstatus konnte nicht geladen werden. Bitte lade die Seite neu.",
  );

  const rejected = await api.recoverProfileColorConflict(async () => {
    throw new Error("refresh unavailable");
  });
  assert.equal(rejected.name, "ProfileColorConflictError");
  assert.equal(rejected.message, unavailable.message);
});
