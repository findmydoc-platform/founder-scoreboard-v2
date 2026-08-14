import type { PlatformRole, Profile } from "@/lib/types";

const personaDefinitions: Record<PlatformRole, { label: string; initials: string }> = {
  ceo: { label: "Clara CEO", initials: "CC" },
  founder: { label: "Felix Founder", initials: "FF" },
  deputy: { label: "Dora Deputy", initials: "DD" },
  viewer: { label: "Viktor Viewer", initials: "VV" },
};

const personaRoleOrder: PlatformRole[] = ["ceo", "founder", "deputy", "viewer"];

export type TestProfilePersona = {
  initials: string;
  label: string;
  platformRole: PlatformRole;
  profileId: string;
};

export function testProfilePersona(profile: Profile): TestProfilePersona {
  const definition = personaDefinitions[profile.platformRole];
  return {
    ...definition,
    platformRole: profile.platformRole,
    profileId: profile.id,
  };
}

export function testProfilePersonas(profiles: Profile[], activeProfileId = "") {
  const activeProfile = profiles.find((profile) => profile.id === activeProfileId) || null;

  return personaRoleOrder.flatMap((platformRole) => {
    const representative = activeProfile?.platformRole === platformRole
      ? activeProfile
      : profiles
        .filter((profile) => profile.platformRole === platformRole)
        .sort((left, right) => left.id.localeCompare(right.id))[0];

    return representative ? [testProfilePersona(representative)] : [];
  });
}
