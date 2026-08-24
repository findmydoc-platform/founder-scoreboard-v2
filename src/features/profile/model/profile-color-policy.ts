export const profileColorOptions = [
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
] as const;

export type ProfileColor = (typeof profileColorOptions)[number]["value"];
export type ProfileColorStatus = "current" | "free" | "occupied" | "reusable";

type ProfileColorSource = Readonly<{
  id: string;
  color?: string | null;
}>;

const profileColors = new Set<string>(profileColorOptions.map((option) => option.value));

export function normalizeProfileColor(value: unknown): ProfileColor | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return profileColors.has(normalized) ? normalized as ProfileColor : null;
}

export function buildProfileColorSavePatch({
  draftColor,
  persistedColor,
  duplicateMode,
}: {
  draftColor: string;
  persistedColor: string;
  duplicateMode: boolean;
}): Partial<{ color: ProfileColor; profileColorDuplicateMode: boolean }> {
  const normalizedDraftColor = normalizeProfileColor(draftColor);
  const normalizedPersistedColor = normalizeProfileColor(persistedColor);
  if (!normalizedDraftColor || normalizedDraftColor === normalizedPersistedColor) return {};
  return {
    color: normalizedDraftColor,
    profileColorDuplicateMode: duplicateMode,
  };
}

export function restoreProfileColorAfterConflict<Value extends { color: string }>(
  draft: Value,
  savedColor: string,
): Value {
  return { ...draft, color: savedColor };
}

function statusLabel(status: ProfileColorStatus) {
  if (status === "current") return "Aktuell";
  if (status === "occupied") return "Vergeben";
  if (status === "reusable") return "Mehrfach möglich";
  return "Frei";
}

function ariaLabel(label: string, status: ProfileColorStatus) {
  if (status === "current") return `${label}, aktuell ausgewählt`;
  if (status === "occupied") return `${label}, vergeben`;
  if (status === "reusable") return `${label}, mehrfach möglich`;
  return `${label}, frei`;
}

export function buildProfileColorPickerModel({
  currentColor,
  currentProfileId,
  profiles,
}: {
  currentColor: string;
  currentProfileId: string;
  profiles: readonly ProfileColorSource[];
}) {
  const normalizedCurrentColor = normalizeProfileColor(currentColor);
  const representedColors = new Set(
    profiles
      .map((profile) => normalizeProfileColor(profile.color))
      .filter((color): color is ProfileColor => color !== null),
  );
  const duplicateMode = profileColorOptions.every((option) => representedColors.has(option.value));

  return {
    duplicateMode,
    options: profileColorOptions.map((option) => {
      const selected = normalizedCurrentColor === option.value;
      const occupiedByOther = profiles.some(
        (profile) => profile.id !== currentProfileId && normalizeProfileColor(profile.color) === option.value,
      );
      const status: ProfileColorStatus = selected
        ? "current"
        : duplicateMode
          ? "reusable"
          : occupiedByOther
            ? "occupied"
            : "free";
      return {
        ...option,
        selected,
        disabled: status === "occupied",
        status,
        statusLabel: statusLabel(status),
        ariaLabel: ariaLabel(option.label, status),
      };
    }),
  };
}
