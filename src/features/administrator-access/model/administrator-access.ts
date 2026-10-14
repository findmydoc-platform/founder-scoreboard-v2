import type { AuthenticatedProfile, PlatformRole } from "@/lib/types";

export type AdministratorAccessSnapshot = Readonly<{
  eligible: boolean;
  active: boolean;
  expiresAt: string | null;
}>;

export type AuthorityCapabilities = Readonly<{
  technicalAdministration: boolean;
  manageAdministratorEligibility: boolean;
  operationalCorrection: boolean;
  ceoGovernance: boolean;
}>;

export type AuthorityCredentialKind = "session" | "planning_token" | "webhook" | "local_simulation";

export type AuthorityProjection = Readonly<{
  administratorAccess: AdministratorAccessSnapshot;
  capabilities: AuthorityCapabilities;
}>;

export type SessionAuthorityContext = AuthorityProjection & Readonly<{
  profile: AuthenticatedProfile;
}>;

export const inactiveAdministratorAccess: AdministratorAccessSnapshot = {
  eligible: false,
  active: false,
  expiresAt: null,
};

export function sessionAuthority({
  platformRole,
  credentialKind,
  administratorAccess,
}: {
  platformRole: PlatformRole;
  credentialKind: AuthorityCredentialKind;
  administratorAccess: AdministratorAccessSnapshot;
}): AuthorityProjection {
  const sessionAdministratorAccess = credentialKind === "session"
    ? administratorAccess
    : inactiveAdministratorAccess;
  const activeAdministrator = sessionAdministratorAccess.active;

  return {
    administratorAccess: sessionAdministratorAccess,
    capabilities: {
      technicalAdministration: activeAdministrator,
      manageAdministratorEligibility: platformRole === "ceo" || activeAdministrator,
      operationalCorrection: activeAdministrator,
      ceoGovernance: platformRole === "ceo",
    },
  };
}
