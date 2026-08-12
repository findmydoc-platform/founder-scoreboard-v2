import "server-only";
import {
  isPlanningScope,
  isPlatformRole,
  type ActorContext,
  type PlanningScope,
  type PlatformRole,
} from "./actor-context";

type TrustedProfile = Readonly<{
  id: string;
  platformRole: PlatformRole;
}>;

type SessionAuthResult =
  | Readonly<{ ok: true; profile: TrustedProfile | null }>
  | Readonly<{ ok: false }>;

type PlanningTokenAuthResult =
  | Readonly<{
    ok: true;
    profile: TrustedProfile;
    tokenId: string;
    scopes: readonly PlanningScope[];
  }>
  | Readonly<{ ok: false }>;

export type ActorContextAdapterResult =
  | Readonly<{ ok: true; actor: ActorContext }>
  | Readonly<{
    ok: false;
    reason: "authenticationRejected" | "profileMissing" | "invalidProfile" | "invalidCredential";
  }>;

function trustedProfile(profile: TrustedProfile | null | undefined) {
  if (!profile) return { ok: false as const, reason: "profileMissing" as const };
  if (!profile.id.trim() || !isPlatformRole(profile.platformRole)) {
    return { ok: false as const, reason: "invalidProfile" as const };
  }
  return {
    ok: true as const,
    profileId: profile.id,
    platformRole: profile.platformRole,
  };
}

function actor(
  profile: TrustedProfile,
  credential: ActorContext["credential"],
): ActorContextAdapterResult {
  const validated = trustedProfile(profile);
  if (!validated.ok) return validated;
  return {
    ok: true,
    actor: Object.freeze({
      profileId: validated.profileId,
      platformRole: validated.platformRole,
      credential: Object.freeze(credential),
    }),
  };
}

export function actorContextFromSessionAuth(
  permission: SessionAuthResult,
): ActorContextAdapterResult {
  if (!permission.ok) return { ok: false, reason: "authenticationRejected" };
  if (!permission.profile) return { ok: false, reason: "profileMissing" };
  return actor(permission.profile, { kind: "session" });
}

export function actorContextFromPlanningTokenAuth(
  permission: PlanningTokenAuthResult,
): ActorContextAdapterResult {
  if (!permission.ok) return { ok: false, reason: "authenticationRejected" };
  if (!permission.tokenId.trim() || permission.scopes.some((scope) => !isPlanningScope(scope))) {
    return { ok: false, reason: "invalidCredential" };
  }
  return actor(permission.profile, {
    kind: "planningToken",
    tokenId: permission.tokenId,
    scopes: Object.freeze([...permission.scopes]),
  });
}

export function actorContextFromLocalDevelopmentProfile(
  profile: TrustedProfile | null,
): ActorContextAdapterResult {
  if (!profile) return { ok: false, reason: "profileMissing" };
  return actor(profile, { kind: "localDevelopment" });
}
