import "server-only";
import { parseCookieHeader, stringFromBase64URL } from "@supabase/ssr";
import type { NextRequest } from "next/server";
import { authOrigin } from "../../auth-redirect";

type RequestTransport = Pick<NextRequest, "headers" | "method">;
export function resolveSessionRequest(request: RequestTransport) {
  const authorization = request.headers.get("authorization");
  if (authorization !== null) return { token: authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "", transport: "bearer" as const };
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  if (!url) return { token: "", transport: "none" as const };
  try {
    const values = new Map(parseCookieHeader(request.headers.get("cookie") || "").map(cookie => [cookie.name, cookie.value || ""]));
    const base = `sb-${new URL(url).hostname.split(".")[0]}-auth-token`;
    const pointer = values.get(`${base}-active`);
    if (pointer && !/^[A-Za-z0-9_-]{32}$/.test(pointer)) return { token: "", transport: "cookie" as const };
    const scoped = `${base}-g-${pointer || "legacy".padEnd(32, "0")}`;
    if (values.get(`${scoped}-revoked`) === "1") return { token: "", transport: "cookie" as const };
    const read = (name: string) => {
      if (values.has(name)) return values.get(name)!;
      let value = "";
      for (let index = 0; index < 64 && values.has(`${name}.${index}`); index++) value += values.get(`${name}.${index}`);
      return value;
    };
    const encoded = read(scoped) || (!pointer ? read(base) : "");
    if (!encoded) return { token: "", transport: "none" as const };
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method || "GET") &&
      (request.headers.get("origin") !== authOrigin() || request.headers.get("sec-fetch-site") === "cross-site")) {
      return { token: "", transport: "cookie" as const, denial: { ok: false as const, status: 403 as const, error: "Keine Berechtigung für diese Anfrage." } };
    }
    const stored = JSON.parse(encoded.startsWith("base64-") ? stringFromBase64URL(encoded.slice(7)) : encoded);
    return { token: typeof stored.access_token === "string" ? stored.access_token : "", transport: "cookie" as const };
  } catch { return { token: "", transport: "cookie" as const }; }
}
