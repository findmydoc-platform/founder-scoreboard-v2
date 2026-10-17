export type PublicResourceInput = { credential: { kind: "public-resource" }; action: "health.inspect" }
  | { credential: { kind: "public-resource" }; action: "historical-initiative.resolve"; targetId: string };
export type PublicResourceResult = ReturnType<typeof import("./internal/public-resources").authorizePublicResource>;
