import { vi } from "vitest";
import { administratorProtocol } from "./administrator-protocol.mjs";

export function planningRouteProtocol({ tables = {}, ...options } = {}) {
  const protocol = administratorProtocol(options), authFetch = globalThis.fetch, requests = [];
  vi.stubGlobal("fetch", async (input, init) => {
    const request = new Request(input, init), url = new URL(request.url);
    const table = url.pathname.startsWith("/rest/v1/") && !url.pathname.includes("/rpc/") ? url.pathname.slice("/rest/v1/".length) : "";
    if (Object.hasOwn(tables, table)) {
      const body = ["GET", "HEAD"].includes(request.method) ? undefined : await request.clone().json();
      requests.push({ table, method: request.method, query: url.searchParams, body });
      const source = tables[table], result = typeof source === "function" ? await source(request, url, body) : source;
      return result instanceof Response ? result : Response.json(result);
    }
    return authFetch(request);
  });
  return { ...protocol, requests };
}
