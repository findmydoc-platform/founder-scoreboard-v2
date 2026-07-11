import { createHash, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { agentScopes, type AgentScope } from "@/features/agent/model/agent-contract";

export type AgentAuthResult =
  | { ok: true; scopes: AgentScope[]; actor: "ceo-agent" }
  | { ok: false; status: 401 | 403; error: string };

function bearerToken(request: NextRequest) {
  const header = request.headers.get("authorization") || "";
  if (!header.startsWith("Bearer ")) return "";
  return header.slice("Bearer ".length).trim();
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function safeHexCompare(left: string, right: string) {
  if (!/^[a-f0-9]{64}$/i.test(left) || !/^[a-f0-9]{64}$/i.test(right)) return false;
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function requireAgentScope(request: NextRequest, scope: AgentScope): AgentAuthResult {
  const expectedHash = process.env.FOUNDEROPS_AGENT_TOKEN_SHA256?.trim() || "";
  const token = bearerToken(request);

  if (!expectedHash || !token) {
    return { ok: false, status: 401, error: "Agent token is required." };
  }

  if (!safeHexCompare(sha256(token), expectedHash)) {
    return { ok: false, status: 401, error: "Agent token is invalid." };
  }

  if (!agentScopes.includes(scope)) {
    return { ok: false, status: 403, error: "Agent token is missing the required scope." };
  }

  return { ok: true, scopes: agentScopes, actor: "ceo-agent" };
}
