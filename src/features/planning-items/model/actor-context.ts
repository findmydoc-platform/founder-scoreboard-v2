export const PLATFORM_ROLES = ["ceo", "founder", "deputy", "viewer"] as const;
export const PLANNING_SCOPES = [
  "read:planning-context",
  "write:planning-items:create",
  "write:planning-items:update",
  "write:planning-items:delete-empty",
  "write:planning-items:github-sync",
] as const;

export type PlatformRole = (typeof PLATFORM_ROLES)[number];
export type PlanningScope = (typeof PLANNING_SCOPES)[number];
export type TokenId = string;

export type ActorContext = Readonly<{
  profileId: string;
  platformRole: PlatformRole;
  credential:
    | Readonly<{ kind: "session" }>
    | Readonly<{
      kind: "planningToken";
      tokenId: TokenId;
      scopes: readonly PlanningScope[];
    }>
    | Readonly<{ kind: "localDevelopment" }>;
}>;

export function isPlatformRole(value: unknown): value is PlatformRole {
  return typeof value === "string" && PLATFORM_ROLES.includes(value as PlatformRole);
}

export function isPlanningScope(value: unknown): value is PlanningScope {
  return typeof value === "string" && PLANNING_SCOPES.includes(value as PlanningScope);
}
