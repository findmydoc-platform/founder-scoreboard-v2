import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const INITIAL_RELEASE_START_PR = 17;
export const INITIAL_RELEASE_TAG = "v0.1.0";
export const RELEASE_REF = "origin/main";
export const GOOGLE_CHAT_SECRET_NAME = "GOOGLE_CHAT_WEBHOOK_URL";
export const GOOGLE_CHAT_WORKFLOW_FILE = "send-release-google-chat.yml";

const SEMVER_TAG_PATTERN = /^v(\d+)\.(\d+)\.(\d+)$/;

const RELEASE_CATEGORIES = [
  {
    id: "auth",
    title: "Auth, Zugriff und GitHub-Verbindung",
    chatSummary:
      "Login, Session-Start und GitHub-Verbindung wurden stabiler und klarer geführt. Das reduziert falsche Login-Zustände und macht die App verlässlicher für geschützte Planung.",
    keywords: ["auth", "session", "login", "github reconnect", "reconnect", "oauth", "access", "zugriff"],
  },
  {
    id: "planning",
    title: "Planung, Workspaces und Review-Fluss",
    chatSummary:
      "Die Planungs- und Review-Flächen wurden stärker auf die tatsächlichen Arbeitsabläufe ausgerichtet: bessere Workspaces, klarere Aufgabensteuerung und weniger Reibung in Review und Sprint.",
    keywords: ["planning", "workspace", "task", "review", "score", "sprint", "assignee", "assignment", "gantt", "plan"],
  },
  {
    id: "github",
    title: "GitHub-Sync und Management-Repo",
    chatSummary:
      "FounderOps nutzt GitHub konsequenter als Arbeitsfläche: Issues, Assignees, Beziehungen und Sync-Queue sind robuster und näher an der nativen GitHub-Struktur.",
    keywords: ["github", "issue", "sync", "assignee", "relationship", "dependencies", "management"],
  },
  {
    id: "operations",
    title: "Betrieb, Deployment und Google Chat",
    chatSummary:
      "Deployment, Readiness und Google-Chat-Anbindung wurden operationalisiert. Dadurch sind Releases, Produktionsbereitschaft und Benachrichtigungen besser kontrollierbar.",
    keywords: ["deploy", "vercel", "google chat", "chat", "readiness", "health", "production", "pnpm", "workflow", "environment"],
  },
  {
    id: "ui",
    title: "Profil, Einstellungen und Bedienbarkeit",
    chatSummary:
      "Profil-, Team- und Einstellungsbereiche wurden übersichtlicher und stabiler. Die Oberfläche führt Nutzer besser durch wiederkehrende FounderOps-Aufgaben.",
    keywords: ["profile", "settings", "team", "ui", "mobile", "navigation", "panel", "copy", "overflow"],
  },
  {
    id: "quality",
    title: "Wartbarkeit und technische Qualität",
    chatSummary:
      "Große Codepfade wurden entkoppelt und wiederverwendbare Helfer gebündelt. Das senkt Folgekosten und macht weitere Produktarbeit sicherer.",
    keywords: ["refactor", "dedupe", "consolidate", "split", "helpers", "mappers", "boilerplate", "contract", "tooling"],
  },
];

export function readArgValue(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return null;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`Missing value for ${name}.`);
  return value;
}

export function run(command, args, { cwd = process.cwd(), input = null } = {}) {
  return execFileSync(command, args, {
    cwd,
    input,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

export function runJson(command, args, options = {}) {
  const output = run(command, args, options);
  return output ? JSON.parse(output) : null;
}

export function ensureGhAuth() {
  run("gh", ["auth", "status"]);
}

export function fetchMainAndTags() {
  run("git", ["fetch", "origin", "main", "--tags", "--prune"]);
}

export function getHeadSha(ref = RELEASE_REF) {
  return run("git", ["rev-parse", ref]);
}

export function getRepoSlug() {
  try {
    return run("gh", ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]);
  } catch {
    const remote = run("git", ["config", "--get", "remote.origin.url"]);
    const match = remote.match(/github\.com[:/](.+?)(?:\.git)?$/);
    if (!match) throw new Error("Could not determine GitHub repository slug.");
    return match[1];
  }
}

export function parseSemverTag(tag) {
  const match = String(tag ?? "").match(SEMVER_TAG_PATTERN);
  if (!match) return null;
  return {
    tag,
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function compareSemverTags(a, b) {
  const parsedA = parseSemverTag(a);
  const parsedB = parseSemverTag(b);
  if (!parsedA && !parsedB) return 0;
  if (!parsedA) return -1;
  if (!parsedB) return 1;
  return parsedA.major - parsedB.major || parsedA.minor - parsedB.minor || parsedA.patch - parsedB.patch;
}

export function getLatestReleaseTag(ref = RELEASE_REF) {
  const output = run("git", ["tag", "--list", "v*.*.*", "--merged", ref]);
  const tags = output.split("\n").map((tag) => tag.trim()).filter(Boolean).filter((tag) => parseSemverTag(tag));
  return tags.sort(compareSemverTags).at(-1) ?? null;
}

export function bumpVersion(tag, bump) {
  const version = parseSemverTag(tag);
  if (!version) throw new Error(`Invalid semantic version tag: ${tag}`);
  if (bump === "major") return `v${version.major + 1}.0.0`;
  if (bump === "minor") return `v${version.major}.${version.minor + 1}.0`;
  return `v${version.major}.${version.minor}.${version.patch + 1}`;
}

export function determineSemverBump(commits) {
  let bump = "patch";
  for (const commit of commits) {
    const text = `${commit.subject ?? ""}\n${commit.body ?? ""}`;
    if (/BREAKING CHANGE:/i.test(text) || /^[a-z]+(?:\([^)]+\))?!:/i.test(commit.subject ?? "")) {
      return "major";
    }
    if (/^feat(?:\([^)]+\))?:/i.test(commit.subject ?? "")) bump = "minor";
  }
  return bump;
}

export function getCommitsSince(lastTag) {
  const output = run("git", ["log", `${lastTag}..${RELEASE_REF}`, "--format=%H%x1f%s%x1f%b%x1e"]);
  return output.split("\x1e").map((record) => record.trim()).filter(Boolean).map((record) => {
    const [sha, subject, body = ""] = record.split("\x1f");
    return { sha, subject, body };
  });
}

export function tagExists(tag) {
  try {
    run("git", ["rev-parse", "--verify", "--quiet", `refs/tags/${tag}`]);
    return true;
  } catch {
    return false;
  }
}

export function releaseExists(repoSlug, tag) {
  try {
    run("gh", ["release", "view", tag, "--repo", repoSlug, "--json", "tagName"]);
    return true;
  } catch {
    return false;
  }
}

export function repositorySecretExists({ repoSlug, secretName }) {
  const response = runJson("gh", ["secret", "list", "--repo", repoSlug, "--json", "name"]);
  const secrets = Array.isArray(response) ? response : response?.secrets ?? [];
  return secrets.some((secret) => secret.name === secretName);
}

export function getReleaseByTag(repoSlug, tag) {
  return runJson("gh", ["release", "view", tag, "--repo", repoSlug, "--json", "name,tagName,url,body"]);
}

export function listMergedPullRequests(repoSlug) {
  return runJson("gh", [
    "pr",
    "list",
    "--repo",
    repoSlug,
    "--state",
    "merged",
    "--base",
    "main",
    "--limit",
    "500",
    "--json",
    "number,title,mergedAt,url,author,baseRefName,headRefName",
  ]);
}

export function getPullRequestDetails(repoSlug, number) {
  return runJson("gh", [
    "pr",
    "view",
    String(number),
    "--repo",
    repoSlug,
    "--json",
    "number,title,body,closingIssuesReferences,commits,mergedAt,url,author,baseRefName,headRefName",
  ]);
}

function latestTagCommitDate(tag) {
  return run("git", ["log", "-1", "--format=%cI", tag]);
}

export function selectReleasePullRequests(pullRequests, { lastTag = null, initialStartPr = INITIAL_RELEASE_START_PR } = {}) {
  const candidates = [...pullRequests].filter((pullRequest) => pullRequest.baseRefName === "main");
  if (!lastTag) {
    return candidates.filter((pullRequest) => pullRequest.number >= initialStartPr).sort((a, b) => a.number - b.number);
  }

  const since = new Date(latestTagCommitDate(lastTag));
  return candidates
    .filter((pullRequest) => new Date(pullRequest.mergedAt) > since)
    .sort((a, b) => new Date(a.mergedAt) - new Date(b.mergedAt) || a.number - b.number);
}

export function isBotPullRequest(pullRequest) {
  const author = pullRequest.author ?? {};
  return Boolean(author.is_bot) || /(^app\/|bot$|dependabot)/i.test(author.login ?? "");
}

export function isMaintenancePullRequest(pullRequest) {
  const title = String(pullRequest.title ?? "");
  return isBotPullRequest(pullRequest)
    || /^chore\(deps/i.test(title)
    || /^build\(deps/i.test(title)
    || /^bump\b/i.test(title)
    || /dependabot/i.test(pullRequest.headRefName ?? "");
}

function normalizeHeading(heading) {
  return String(heading ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseMarkdownSections(markdown) {
  const sections = new Map();
  let current = null;
  for (const line of String(markdown ?? "").split(/\r?\n/)) {
    const heading = line.match(/^(#{2,3})\s+(.+?)\s*$/);
    if (heading) {
      current = normalizeHeading(heading[2]);
      if (!sections.has(current)) sections.set(current, []);
      continue;
    }
    if (current) sections.get(current).push(line);
  }
  return sections;
}

function cleanSummaryText(text) {
  const lines = String(text ?? "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*[-*]\s+/, "").trim())
    .filter(Boolean)
    .filter((line) => !/^```/.test(line))
    .filter((line) => !/^(npm|pnpm|node|\/Users\/|UI checked|Closes #|https?:\/\/github\.com)/i.test(line))
    .filter((line) => !/^\[[ x]\]/i.test(line));
  return lines.join(" ");
}

function extractGermanManagementSummary(body) {
  const management = String(body ?? "").match(/##\s+Management summary[\s\S]*?###\s+Deutsch\s*([\s\S]*?)(?:###\s+English|##\s+|$)/i);
  return management ? cleanSummaryText(management[1]) : "";
}

export function extractPrSummary(pullRequest) {
  const body = pullRequest.body ?? "";
  const managementSummary = extractGermanManagementSummary(body);
  if (managementSummary) return managementSummary;

  const sections = parseMarkdownSections(body);
  const preferredHeadings = [
    "summary",
    "zusammenfassung",
    "was geandert",
    "what changed",
    "warum",
    "why",
  ];
  for (const heading of preferredHeadings) {
    const value = sections.get(heading);
    const cleaned = cleanSummaryText(value?.join("\n") ?? "");
    if (cleaned) return cleaned;
  }

  return cleanSummaryText(pullRequest.title) || `PR #${pullRequest.number}`;
}

function categoryScore(pullRequest, category) {
  const text = `${pullRequest.title ?? ""}\n${pullRequest.body ?? ""}\n${pullRequest.headRefName ?? ""}`.toLowerCase();
  return category.keywords.reduce((score, keyword) => score + (text.includes(keyword) ? 1 : 0), 0);
}

export function categorizePullRequest(pullRequest) {
  let bestCategory = RELEASE_CATEGORIES.at(-1);
  let bestScore = 0;
  for (const category of RELEASE_CATEGORIES) {
    const score = categoryScore(pullRequest, category);
    if (score > bestScore) {
      bestScore = score;
      bestCategory = category;
    }
  }
  return bestCategory;
}

export function buildReleaseContext(pullRequests) {
  const stakeholderPullRequests = pullRequests.filter((pullRequest) => !isMaintenancePullRequest(pullRequest));
  const maintenancePullRequests = pullRequests.filter((pullRequest) => isMaintenancePullRequest(pullRequest));
  const categories = RELEASE_CATEGORIES.map((category) => ({
    ...category,
    pullRequests: stakeholderPullRequests.filter((pullRequest) => categorizePullRequest(pullRequest).id === category.id),
  })).filter((category) => category.pullRequests.length > 0);

  return {
    stakeholderPullRequests,
    maintenancePullRequests,
    categories,
  };
}

function formatIssueLinks(pullRequest) {
  const issues = pullRequest.closingIssuesReferences ?? [];
  if (!issues.length) return "";
  return issues.map((issue) => `#${issue.number}`).join(", ");
}

function formatPullRequestLine(pullRequest) {
  const issues = formatIssueLinks(pullRequest);
  const suffix = issues ? `; closes ${issues}` : "";
  return `- [#${pullRequest.number}](${pullRequest.url}) ${pullRequest.title}${suffix}`;
}

export function buildReleaseNotes({ releaseTag, releasePlan, releaseUrl = null }) {
  const context = buildReleaseContext(releasePlan.pullRequests);
  const lines = [
    `# FounderOps ${releaseTag}`,
    "",
    "## Management summary",
    "",
  ];

  for (const category of context.categories) {
    lines.push(`### ${category.title}`);
    lines.push(category.chatSummary);
    lines.push("");
    for (const pullRequest of category.pullRequests) {
      lines.push(formatPullRequestLine(pullRequest));
      const summary = extractPrSummary(pullRequest);
      if (summary && summary !== pullRequest.title) lines.push(`  - ${summary}`);
    }
    lines.push("");
  }

  if (context.maintenancePullRequests.length) {
    lines.push("## Maintenance");
    lines.push("");
    for (const pullRequest of context.maintenancePullRequests) lines.push(formatPullRequestLine(pullRequest));
    lines.push("");
  }

  lines.push("## Release control");
  lines.push("");
  lines.push(`- Release range: ${releasePlan.rangeLabel}`);
  lines.push(`- Target commit: ${releasePlan.targetCommit}`);
  lines.push(`- Stakeholder PRs: ${context.stakeholderPullRequests.length}`);
  lines.push(`- Maintenance PRs: ${context.maintenancePullRequests.length}`);
  if (releaseUrl) lines.push(`- Release URL: ${releaseUrl}`);

  return lines.join("\n").trimEnd() + "\n";
}

export function buildChatMessage({ releaseTag, releasePlan, releaseUrl, siteUrl = "https://founder-ops.findmydoc.eu" }) {
  const context = buildReleaseContext(releasePlan.pullRequests);
  const categories = context.categories.slice(0, 7);
  const lines = [
    `FounderOps Release ${releaseTag} ist live.`,
    "",
    "Diese Nachricht betrifft FounderOps, nicht die findmydoc Website.",
    "",
    `Dieser Release fasst ${context.stakeholderPullRequests.length} produktrelevante PRs seit ${releasePlan.rangeLabel} zusammen. Die Details stehen in den GitHub Release Notes.`,
    "",
  ];

  categories.forEach((category, index) => {
    lines.push(`${index + 1}. ${category.title}`);
    lines.push(category.chatSummary);
    lines.push("");
  });

  if (context.maintenancePullRequests.length) {
    lines.push(`Zusätzlich wurden ${context.maintenancePullRequests.length} Wartungs- und Abhängigkeitsänderungen mit ausgeliefert; sie sind in den Release Notes separat aufgeführt.`);
    lines.push("");
  }

  lines.push(`Release Notes: ${releaseUrl}`);
  lines.push(`Live: ${siteUrl}`);
  return lines.join("\n").trim();
}

export function buildWorkflowDispatchPayload({ ref = "main", inputs = null }) {
  return inputs && Object.keys(inputs).length ? { ref, inputs } : { ref };
}

export function buildGoogleChatPayload(messageText, releaseTag = null) {
  const text = String(messageText ?? "").replace(/\r\n/g, "\n").trim();
  if (!text) throw new Error("Missing Google Chat message text.");
  const payload = { text };
  if (releaseTag) payload.thread = { threadKey: `founderops-release-${releaseTag.replace(/[^a-z0-9._-]+/gi, "-")}` };
  return payload;
}

export function dispatchWorkflow({ repoSlug, workflowFile, ref = "main", inputs = null }) {
  const dispatchedAt = new Date().toISOString();
  run("gh", ["api", `repos/${repoSlug}/actions/workflows/${workflowFile}/dispatches`, "--method", "POST", "--input", "-"], {
    input: JSON.stringify(buildWorkflowDispatchPayload({ ref, inputs })),
  });
  return { dispatchedAt, ref, inputs };
}

export async function waitForWorkflowRun({
  repoSlug,
  workflowFile,
  ref = "main",
  headSha,
  dispatchedAt,
  timeoutSeconds = Number(process.env.FOUNDEROPS_RELEASE_RUN_TIMEOUT_SECONDS ?? 900),
  pollIntervalSeconds = Number(process.env.FOUNDEROPS_RELEASE_POLL_INTERVAL_SECONDS ?? 10),
}) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutSeconds * 1000) {
    const runs = runJson("gh", [
      "api",
      `repos/${repoSlug}/actions/workflows/${workflowFile}/runs?event=workflow_dispatch&branch=${encodeURIComponent(ref)}&per_page=10`,
    ]);
    const runInfo = (runs.workflow_runs ?? []).find((workflowRun) => {
      const createdAt = new Date(workflowRun.created_at).getTime();
      return workflowRun.head_sha === headSha && createdAt >= new Date(dispatchedAt).getTime() - 30_000;
    });
    if (runInfo?.status === "completed") {
      if (runInfo.conclusion !== "success") {
        throw new Error(`${workflowFile} completed with conclusion ${runInfo.conclusion}: ${runInfo.html_url}`);
      }
      return runInfo;
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalSeconds * 1000));
  }
  throw new Error(`Timed out waiting for ${workflowFile}.`);
}

export function createRelease({ repoSlug, tag, targetCommitish, notes }) {
  const releaseDir = mkdtempSync(join(tmpdir(), "founderops-release-"));
  const notesFile = join(releaseDir, `${tag}.md`);
  writeFileSync(notesFile, notes, "utf8");
  run("gh", [
    "release",
    "create",
    tag,
    "--repo",
    repoSlug,
    "--target",
    targetCommitish,
    "--title",
    `FounderOps ${tag}`,
    "--notes-file",
    notesFile,
  ]);
  return getReleaseByTag(repoSlug, tag);
}

export async function determineNextRelease({ repoSlug = getRepoSlug(), initialStartPr = INITIAL_RELEASE_START_PR } = {}) {
  const targetCommit = getHeadSha(RELEASE_REF);
  const lastTag = getLatestReleaseTag(RELEASE_REF);
  const pullRequests = selectReleasePullRequests(listMergedPullRequests(repoSlug), {
    lastTag,
    initialStartPr,
  }).map((pullRequest) => getPullRequestDetails(repoSlug, pullRequest.number));

  if (!lastTag) {
    return {
      mode: "initial",
      lastTag: null,
      nextTag: INITIAL_RELEASE_TAG,
      bump: "minor",
      bumpReason: `Initial release starts at PR #${initialStartPr}.`,
      rangeLabel: `PR #${initialStartPr} bis ${RELEASE_REF}`,
      targetCommit,
      pullRequests,
      commits: [],
    };
  }

  const commits = getCommitsSince(lastTag);
  const bump = determineSemverBump(commits);
  return {
    mode: "incremental",
    lastTag,
    nextTag: bumpVersion(lastTag, bump),
    bump,
    bumpReason: `${bump} bump from commit history since ${lastTag}.`,
    rangeLabel: `${lastTag}..${RELEASE_REF}`,
    targetCommit,
    pullRequests,
    commits,
  };
}

export function renderUsedPullRequests(releasePlan) {
  const context = buildReleaseContext(releasePlan.pullRequests);
  const lines = [
    "Used PRs for stakeholder release narrative:",
    ...context.stakeholderPullRequests.map((pullRequest) => formatPullRequestLine(pullRequest)),
  ];
  if (context.maintenancePullRequests.length) {
    lines.push("");
    lines.push("Maintenance PRs excluded from chat narrative:");
    lines.push(...context.maintenancePullRequests.map((pullRequest) => formatPullRequestLine(pullRequest)));
  }
  return lines.join("\n");
}

export function formatReleasePlanSummary(releasePlan) {
  return [
    `Release mode: ${releasePlan.mode}`,
    `Last tag: ${releasePlan.lastTag ?? "none"}`,
    `Next tag: ${releasePlan.nextTag}`,
    `Bump: ${releasePlan.bump}`,
    `Reason: ${releasePlan.bumpReason}`,
    `Range: ${releasePlan.rangeLabel}`,
    `Target commit: ${releasePlan.targetCommit}`,
    `PRs: ${releasePlan.pullRequests.length}`,
  ].join("\n");
}
