import "server-only";
import { createHash, randomBytes } from "node:crypto";
import {
  type TeamPlanningItemScope,
  type TeamPlanningItemTokenRecord,
} from "@/features/planning-items/model/planning-items-contract";
type TokenRow = {
  id: string;
  profile_id: string;
  label: string;
  token_hash: string;
  token_hint: string;
  scopes: TeamPlanningItemScope[] | null;
  expires_at: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};

const tokenPrefix = "fmd_ti_";

export function hashTeamPlanningItemsToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function createTeamPlanningItemsToken() {
  const token = `${tokenPrefix}${randomBytes(32).toString("base64url")}`;
  return {
    token,
    tokenHash: hashTeamPlanningItemsToken(token),
    tokenHint: `…${token.slice(-6)}`,
  };
}

export function mapTeamPlanningItemsTokenRecord(
  row: Omit<TokenRow, "token_hash" | "profile_id">,
): TeamPlanningItemTokenRecord {
  return {
    id: row.id,
    label: row.label,
    tokenHint: row.token_hint,
    scopes: row.scopes || [],
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at || "",
    revokedAt: row.revoked_at || "",
  };
}
