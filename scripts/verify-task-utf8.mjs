import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const TASK_FIELDS = [
  "title",
  "description",
  "definition_of_done",
  "problem_statement",
  "intended_outcome",
  "scope_constraints",
  "acceptance_criteria",
  "evidence_required",
];

const BROKEN_WORD_QUESTION_MARK = /[A-Za-zÄÖÜäöüß]\?[A-Za-zÄÖÜäöüß]|\?[A-Za-zÄÖÜäöüß]{2,}/;
const MOJIBAKE = /Ã|Â|�/;

function loadEnvFile() {
  const file = resolve(process.cwd(), ".env.local");
  if (!existsSync(file)) return {};

  const env = {};
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    env[key] = rawValue.replace(/^["']|["']$/g, "");
  }
  return env;
}

const fileEnv = loadEnvFile();
const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.SUPABASE_URL ||
  fileEnv.NEXT_PUBLIC_SUPABASE_URL ||
  fileEnv.SUPABASE_URL;
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  fileEnv.SUPABASE_SERVICE_ROLE_KEY ||
  fileEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  fileEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.log("verify:task-utf8 skipped: Supabase environment is missing.");
  process.exit(0);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data, error } = await supabase
  .from("tasks")
  .select(["id", ...TASK_FIELDS].join(","));

if (error) {
  console.error(`verify:task-utf8 failed: ${error.message}`);
  process.exit(1);
}

const findings = [];

for (const task of data || []) {
  for (const field of TASK_FIELDS) {
    const value = task[field];
    if (typeof value !== "string" || !value) continue;
    if (BROKEN_WORD_QUESTION_MARK.test(value) || MOJIBAKE.test(value)) {
      findings.push({
        id: task.id,
        field,
        sample: value.replace(/\s+/g, " ").slice(0, 180),
      });
    }
  }
}

if (findings.length) {
  console.error(`verify:task-utf8 found ${findings.length} suspicious task text value(s):`);
  console.error(JSON.stringify(findings.slice(0, 20), null, 2));
  process.exit(1);
}

console.log(`verify:task-utf8 ok: checked ${(data || []).length} task(s).`);
