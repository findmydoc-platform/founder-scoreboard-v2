import { installationGraphqlDocuments } from "../../github-graphql-documents";
import { allowedGitHubAssetUrl } from "../../github-asset-policy";
import "server-only";
import { createHash, createSign } from "node:crypto";
import { GitHubApiError, githubJson, githubRequest, type GitHubRequestOptions } from "../../github-http";
import { GitHubAppConfigurationError } from "../../github-app-errors";
import { allowedGitHubRepositories } from "../../github-repositories";
import type { GitHubInstallationInput, GitHubInstallationCapability } from "../types";
import type { GitHubAppOperationalStatus } from "../../github-app";

const tokenRefreshWindowMs = 5 * 60 * 1000;
function env(name: string) { return process.env[name]?.trim() || ""; }
function requireEnv(name: string) {
  const value = env(name);
  if (!value) throw new GitHubAppConfigurationError(`${name} ist nicht gesetzt.`);
  return value;
}
function base64UrlJson(value: unknown) { return Buffer.from(JSON.stringify(value)).toString("base64url"); }
function resolvePrivateKeyPath(value: string) {
  if (value.startsWith("~/")) return `${process.env.HOME || ""}/${value.slice(2)}`;
  return value;
}

async function githubAppPrivateKey() {
  const inline = process.env.GITHUB_APP_PRIVATE_KEY;
  if (inline) return inline.replace(/\\n/g, "\n");
  const keyPath = env("GITHUB_APP_PRIVATE_KEY_PATH");
  if (!keyPath) throw new GitHubAppConfigurationError("GITHUB_APP_PRIVATE_KEY oder GITHUB_APP_PRIVATE_KEY_PATH ist nicht gesetzt.");
  // Keep runtime-only private key files out of Next's static output trace.
  const runtimeImport = Function("specifier", "return import(specifier)") as (specifier: string) => Promise<typeof import("node:fs/promises")>;
  const { readFile } = await runtimeImport("node:fs/promises");
  try {
    return await readFile(resolvePrivateKeyPath(keyPath), "utf8");
  } catch {
    throw new GitHubAppConfigurationError("Der private Schlüssel der GitHub App konnte nicht gelesen werden.");
  }
}

async function githubAppJwt() {
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlJson({ alg: "RS256", typ: "JWT" });
  const payload = base64UrlJson({
    iat: now - 60,
    exp: now + 540,
    iss: requireEnv("GITHUB_APP_ID"),
  });
  const data = `${header}.${payload}`;
  let signature: string;
  try {
    signature = createSign("RSA-SHA256").update(data).sign(await githubAppPrivateKey(), "base64url");
  } catch (error) {
    if (error instanceof GitHubAppConfigurationError) throw error;
    throw new GitHubAppConfigurationError("Der private Schlüssel der GitHub App ist ungültig.");
  }
  return `${data}.${signature}`;
}

type InstallationToken = { token: string; expiresAt: number };
const tokens = new Map<string, InstallationToken>();
const pending = new Map<string, Promise<InstallationToken>>();

function configuration() {
  const appId = requireEnv("GITHUB_APP_ID");
  const installationId = requireEnv("GITHUB_APP_INSTALLATION_ID");
  if (!/^[1-9]\d*$/.test(installationId)) throw new GitHubAppConfigurationError("GitHub-App-Installation ist ungültig.");
  // Bind process-local reuse to app, installation and key configuration without retaining a key in the cache key.
  const key = createHash("sha256").update(JSON.stringify([appId, installationId,
    process.env.GITHUB_APP_PRIVATE_KEY || "", env("GITHUB_APP_PRIVATE_KEY_PATH")])).digest("hex");
  return { installationId, key };
}

async function installationToken(repositories: readonly string[]) {
  const config = configuration();
  const key = `${config.key}:${repositories.join(",")}`;
  const cached = tokens.get(key);
  if (cached && cached.expiresAt - Date.now() > tokenRefreshWindowMs) return cached;
  const current = pending.get(key);
  if (current) return current;
  const acquisition = (async () => {
    const jwt = await githubAppJwt();
    // Configuration changes during async key loading cannot bind a token to a different installation.
    if (configuration().key !== config.key) throw new GitHubAppConfigurationError("GitHub-App-Konfiguration wurde geändert.");
    const body = await githubJson<{ token: string; expires_at: string }>(
      `https://api.github.com/app/installations/${config.installationId}/access_tokens`, {
        token: jwt, method: "POST", operation: "mutation",
        body: { repositories: repositories.map(repository => repository.split("/")[1]) },
        errorMessage: "GitHub-App-Installationstoken konnte nicht erzeugt werden",
      });
    const expiresAt = Date.parse(body.expires_at);
    if (!body.token || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) throw new Error("GitHub-App-Installationstoken ist ungültig.");
    const result = { token: body.token, expiresAt };
    if (tokens.size >= 32) tokens.delete(tokens.keys().next().value!);
    tokens.set(key, result);
    return result;
  })().catch(error => {
    if (error instanceof GitHubApiError) throw new GitHubApiError("GitHub-App-Installationstoken konnte nicht erzeugt werden.", error);
    throw error;
  });
  pending.set(key, acquisition);
  try { return await acquisition; } finally { pending.delete(key); }
}

function permittedApiTarget(value: string, repositories: readonly string[], options: Omit<GitHubRequestOptions, "token">, organization?: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== "api.github.com" || url.port || url.username || url.password || url.hash) return false;
  const repositoryMatch = /^\/repos\/([^/]+\/[^/]+)(?:\/|$)/.exec(url.pathname);
  if (repositoryMatch) return repositories.includes(repositoryMatch[1]);
  if (url.pathname === "/search/issues") {
    const query = url.searchParams.get("q") || "";
    const targets = [...query.matchAll(/(?:^|\s)repo:([^\s]+)/g)].map(match => match[1]);
    return targets.length > 0 && targets.every(repository => repositories.includes(repository));
  }
  // GraphQL resource adapters use provider-scoped installation credentials. GitHub enforces
  // repository visibility and installation permissions for opaque node and Project IDs.
  if (url.pathname === "/graphql") {
    const body = options.body as { query?: string; variables?: Record<string, unknown> } | undefined;
    if (!body?.query || !installationGraphqlDocuments.has(body.query)) return false;
    if (body.query.startsWith("mutation") !== (options.operation === "mutation")) return false;
    const variables = body.variables || {};
    for (const match of body.query.matchAll(/repository\(owner: \$(\w+), name: \$(\w+)\)/g)) {
      if (!repositories.includes(`${variables[match[1]]}/${variables[match[2]]}`)) return false;
    }
    if (organization && body.query.includes("organization(login: $owner)") && variables.owner !== organization) return false;
    return true;
  }
  return Boolean(organization && url.pathname.startsWith(`/orgs/${encodeURIComponent(organization)}/teams/`) && /^\/orgs\/[^/]+\/teams\/[^/]+$/.test(url.pathname));
}

export async function authorizeGitHubInstallation(input: GitHubInstallationInput) {
  const repositories = [...new Set(input.target.repositories)].sort();
  if (!repositories.length || repositories.some(repository => !allowedGitHubRepositories.has(repository))) {
    throw new Error("GitHub-Ziel-Repository ist nicht freigegeben.");
  }
  const action = input.action;
  const organization = input.target.organization;
  const assetUrl = input.target.assetUrl;
  if ((action === "github.team.read" || action === "github.project.read") && (!organization || !/^[a-z\d](?:[a-z\d-]{0,38})$/i.test(organization))) throw new Error("GitHub-Organisation ist ungültig.");
  if (action === "github.asset.read" && (!assetUrl || !allowedGitHubAssetUrl(assetUrl))) throw new Error("GitHub-Anhang ist nicht freigegeben.");
  const binding = configuration().key;
  await installationToken(repositories);
  const capability: GitHubInstallationCapability = Object.freeze({
    async asset(url: string) {
      if (configuration().key !== binding) throw new Error("GitHub-App-Konfiguration wurde geändert.");
      if (action !== "github.asset.read" || url !== assetUrl) throw new Error("GitHub-Aktion ist nicht freigegeben.");
      const credential = await installationToken(repositories);
      return fetchGitHubAsset(url, credential.token);
    },
    async request(url: string, requestOptions: Omit<GitHubRequestOptions, "token">) {
      const options = { ...requestOptions, ...(requestOptions.body === undefined ? {} : { body: structuredClone(requestOptions.body) }) };
      if (configuration().key !== binding) throw new Error("GitHub-App-Konfiguration wurde geändert.");
      const path = new URL(url).pathname;
      const mutation = options.operation === "mutation";
      const repositoryIssue = /^\/repos\/[^/]+\/[^/]+\/issues(?:\/|$)/.test(path);
      const assignableUserRead = !mutation && /^\/repos\/[^/]+\/[^/]+\/assignees\/[^/]+$/.test(path);
      if ((action === "github.projection.apply" && !repositoryIssue && !assignableUserRead && path !== "/graphql" && path !== "/search/issues")
        || (action === "github.issue.read" && !repositoryIssue && path !== "/graphql")
        || action === "github.asset.read"
        || (mutation && action !== "github.projection.apply" && action !== "github.lifecycle.apply")
        || (action === "github.project.read" && path !== "/graphql")
        || (action === "github.team.read" && !path.startsWith("/orgs/"))
        || (action === "github.lifecycle.apply" && !/^\/repos\/[^/]+\/[^/]+\/issues(?:\/|$)/.test(path))) {
        throw new Error("GitHub-Aktion ist nicht freigegeben.");
      }
      if (!permittedApiTarget(url, repositories, options, organization)) throw new Error("GitHub-Ziel ist nicht freigegeben.");
      const credential = await installationToken(repositories);
      // No credential response or network failure replays a resource mutation.
      return githubRequest(url, { ...options, token: credential.token } as GitHubRequestOptions);
    },
  });
  return { ok: true as const, github: capability };
}
export async function installationOperationalStatus(): Promise<GitHubAppOperationalStatus> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4_000);

  try {
    const installationId = requireEnv("GITHUB_APP_INSTALLATION_ID");
    const installation = await githubJson<{ id: number }>(
      `https://api.github.com/app/installations/${encodeURIComponent(installationId)}`,
      {
        token: await githubAppJwt(),
        method: "GET",
        operation: "read",
        signal: controller.signal,
        errorMessage: "GitHub-App-Installation konnte nicht geprüft werden",
      },
    );
    if (String(installation.id) !== installationId) throw new Error("GitHub installation does not match configuration.");
    return {
      available: true,
      state: "ready",
      description: "Die GitHub App ist erreichbar und die Installation ist verfügbar.",
      nextStep: "",
    };
  } catch (error) {
    if (error instanceof GitHubAppConfigurationError) {
      return {
        available: false,
        state: "configuration_required",
        description: "Die serverseitige GitHub-App-Konfiguration ist unvollständig.",
        nextStep: "GitHub-App-ID, Installation und privaten Schlüssel in der Laufzeitkonfiguration prüfen.",
      };
    }
    return {
      available: false,
      state: "unavailable",
      description: "Die GitHub-App-Installation ist momentan nicht erreichbar.",
      nextStep: "Installation, Berechtigungen und GitHub-Verfügbarkeit prüfen.",
    };
  } finally {
    clearTimeout(timeout);
  }
}

const maxGitHubAssetRedirects = 3;
const redirectStatuses = new Set([301, 302, 303, 307, 308]);

async function fetchGitHubAsset(value: string, token: string) {
  const initialUrl = allowedGitHubAssetUrl(value);
  if (!initialUrl) return null;
  let url: URL = initialUrl;

  for (let redirectCount = 0; redirectCount <= maxGitHubAssetRedirects; redirectCount += 1) {
    const headers = new Headers({
      accept: "image/avif,image/webp,image/png,image/jpeg,image/gif,image/svg+xml,*/*",
      "user-agent": "Founder Scoreboard v2",
    });
    if (url.hostname === "github.com") headers.set("authorization", `Bearer ${token}`);

    // This URL passed the asset-host allowlist; every redirect is checked before the next request.
    const response: Response = await fetch(url, {
      method: "GET",
      headers,
      cache: "no-store",
      redirect: "manual",
    });

    if (!redirectStatuses.has(response.status)) return response;
    if (redirectCount === maxGitHubAssetRedirects) {
      await response.body?.cancel().catch(() => undefined);
      return null;
    }

    const locationHeader: string | null = response.headers.get("location");
    const nextUrl: URL | null = locationHeader ? allowedGitHubAssetUrl(locationHeader, url) : null;
    await response.body?.cancel().catch(() => undefined);
    if (!nextUrl) return null;
    url = nextUrl;
  }

  return null;
}

