import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";

const LEGACY_SECTION_START =
  /(?:^|\n)\s*#{1,6}\s*(?:Non-Tech Summary|Follow-up Issues(?:\s*\(optional\))?)\b/i;
const LEGACY_SECTION_MARKERS =
  /#{1,6}\s*(?:Non-Tech Summary|Follow-up Issues(?:\s*\(optional\))?)\b|_?No response\.?_?/i;
const URL_PATTERN = /https?:\/\/[^\s<>"')]+/gi;

function parseEnvLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const separator = trimmed.indexOf("=");
  if (separator < 0) return null;
  const key = trimmed.slice(0, separator).trim();
  const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, "");
  return [key, value];
}

async function loadEnvFile() {
  const envPath = resolve(process.cwd(), ".env.local");
  if (!existsSync(envPath)) return;
  const envFile = await readFile(envPath, "utf8");
  for (const pair of envFile.split(/\r?\n/).map(parseEnvLine)) {
    if (!pair) continue;
    const [key, value] = pair;
    process.env[key] ||= value;
  }
}

function uniqueUrls(value) {
  const seen = new Set();
  const urls = [];
  for (const match of value.matchAll(URL_PATTERN)) {
    const url = match[0].replace(/[.,;:]+$/g, "");
    if (seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
  }
  return urls;
}

export function cleanEvidenceLinkValue(value) {
  const original = String(value || "").trim();
  if (!original) return { changed: false, value: "" };

  if (!LEGACY_SECTION_MARKERS.test(original)) {
    return { changed: false, value: original };
  }

  const normalizedHeadings = original
    .replace(/(#{1,6}\s*(?:Non-Tech Summary|Follow-up Issues(?:\s*\(optional\))?))/gi, "\n$1")
    .replace(/\r\n/g, "\n")
    .trim();

  const beforeLegacySection = normalizedHeadings.split(LEGACY_SECTION_START)[0] || "";
  const withoutNoResponse = beforeLegacySection
    .replace(/_?No response\.?_?/gi, "")
    .replace(/#{1,6}\s*Evidence Link\b/gi, "")
    .trim();

  const urls = uniqueUrls(withoutNoResponse);
  const cleaned = urls.length ? urls.join("\n") : withoutNoResponse;

  return {
    changed: cleaned !== original,
    value: cleaned,
  };
}

async function main() {
  await loadEnvFile();

  const apply = process.argv.includes("--apply");
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error("Missing Supabase environment. Check .env.local.");
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase
    .from("tasks")
    .select("id,title,evidence_link,github_sync_status,github_issue_number,github_issue_url,issue_number,issue_url")
    .order("title", { ascending: true });

  if (error) {
    console.error(`Could not load tasks: ${error.message}`);
    process.exit(1);
  }

  const repairs = [];
  for (const task of data || []) {
    const result = cleanEvidenceLinkValue(task.evidence_link);
    if (!result.changed) continue;
    repairs.push({
      id: task.id,
      title: task.title,
      before: String(task.evidence_link || "").replace(/\s+/g, " ").slice(0, 180),
      after: result.value,
      hasGitHubIssue: Boolean(task.github_issue_number || task.issue_number || task.github_issue_url || task.issue_url),
    });
  }

  if (!repairs.length) {
    console.log("repair:evidence-link ok: no legacy Evidence Link section remnants found.");
    return;
  }

  console.log(`repair:evidence-link found ${repairs.length} task(s) with legacy section remnants.`);
  console.log(JSON.stringify(repairs.map(({ id, title, before, after }) => ({ id, title, before, after })), null, 2));

  if (!apply) {
    console.log("Dry run only. Re-run with --apply to update Supabase.");
    return;
  }

  for (const repair of repairs) {
    const update = {
      evidence_link: repair.after || null,
      github_sync_error: null,
    };
    if (repair.hasGitHubIssue) {
      update.github_sync_status = "not_synced";
    }

    const { error: updateError } = await supabase
      .from("tasks")
      .update(update)
      .eq("id", repair.id);

    if (updateError) {
      console.error(`Could not update ${repair.id}: ${updateError.message}`);
      process.exit(1);
    }
  }

  console.log(`repair:evidence-link applied: cleaned ${repairs.length} task(s).`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  await main();
}
