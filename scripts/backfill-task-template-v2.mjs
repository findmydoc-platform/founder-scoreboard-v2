import { mkdir, writeFile } from "node:fs/promises";
import { createSupabaseScriptClient } from "./lib/supabase.mjs";

const APPLY = process.argv.includes("--apply");
const SHOW_INDEX = process.argv.indexOf("--show");
const SHOW_ID = SHOW_INDEX >= 0 ? process.argv[SHOW_INDEX + 1] : "";

const supabase = await createSupabaseScriptClient({
  keyEnv: ["SUPABASE_SERVICE_ROLE_KEY"],
});

const PLACEHOLDERS = new Set([
  "",
  "Was geh\u00f6rt dazu, was nicht?",
  "Welcher Nachweis wird erwartet?",
  "No response",
  "Noch offen",
  "TBD",
  "tbd",
]);

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isPlaceholder(value) {
  return PLACEHOLDERS.has(clean(value));
}

function firstSentence(value) {
  const text = clean(value).replace(/\s+/g, " ");
  if (!text) return "";
  const match = text.match(/^(.+?[.!?])\s/);
  return match ? match[1] : text;
}

function ensurePeriod(value) {
  const text = clean(value);
  if (!text) return "";
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function trimText(value, max = 900) {
  const text = clean(value).replace(/\s+/g, " ");
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trim()}…`;
}

function evidenceLabel(task) {
  const workstream = clean(task.workstream).toLowerCase();
  const title = clean(task.title).toLowerCase();

  if (workstream.includes("mvp") || title.includes("website") || title.includes("crawler") || title.includes("404")) {
    return "GitHub-Link, PR, Screenshot oder kurzer Testnachweis, der die Umsetzung und Pr\u00fcfung belegt.";
  }
  if (workstream.includes("legal") || title.includes("legal") || title.includes("marken") || title.includes("compliance")) {
    return "Notion-/Drive-Link oder Entscheidungsnotiz mit Quellen, Risiken, offenen Punkten und empfohlener n\u00e4chster Entscheidung.";
  }
  if (workstream.includes("investor") || workstream.includes("funding") || title.includes("investor") || title.includes("funding")) {
    return "Notion-/CRM-Link, Versandnachweis oder Review-Dokument mit Status, Empf\u00e4ngern, n\u00e4chstem Schritt und Owner.";
  }
  if (workstream.includes("klinik") || title.includes("clinic") || title.includes("klinik") || title.includes("outreach")) {
    return "CRM-/Pipeline-Link, Kontaktliste oder Versand-/Call-Nachweis mit dokumentiertem Ergebnis und n\u00e4chstem Schritt.";
  }
  if (workstream.includes("marketing") || title.includes("copy") || title.includes("blog") || title.includes("seo")) {
    return "Notion-/Drive-Link mit finalem Draft, Review-Kommentaren oder konkreter \u00c4nderungsliste.";
  }
  return "Notion-, Drive-, GitHub- oder CRM-Link mit kurzem Ergebnisnachweis, der zeigt, dass die Aufgabe reviewbar abgeschlossen wurde.";
}

function scopeFor(task) {
  const title = clean(task.title);
  const description = firstSentence(task.description);
  const base = description || `Die konkrete Umsetzung zu \"${title}\".`;
  return [
    `Geh\u00f6rt dazu: ${ensurePeriod(base)}`,
    "Ebenfalls dazu geh\u00f6rt, offene Annahmen, Risiken und Entscheidungen so festzuhalten, dass Volkan oder der Review-Owner sie schnell pr\u00fcfen kann.",
    "Nicht dazu geh\u00f6rt: Scope-Ausweitung, strategische Grundsatzentscheidungen oder Umsetzung au\u00dferhalb dieser Aufgabe ohne separate Freigabe.",
  ].join("\n");
}

function acceptanceFor(task) {
  const description = firstSentence(task.description);
  const done = firstSentence(task.definition_of_done);
  const evidence = task.evidence_link ? "Der Nachweis ist direkt in der Aufgabe verlinkt." : "Der passende Nachweis ist vorbereitet und kann im Review gepr\u00fcft werden.";
  const taskResult = done || description || `\"${clean(task.title)}\" ist nachvollziehbar erledigt.`;

  return [
    `- ${ensurePeriod(taskResult)}`,
    "- Der Arbeitsstand ist so dokumentiert, dass eine andere Person den Stand ohne R\u00fcckfrage nachvollziehen kann.",
    `- ${evidence}`,
    "- Offene Risiken, Blocker oder Anschlussaufgaben sind in der Aufgabe oder im verlinkten Dokument festgehalten.",
  ].join("\n");
}

function isWeakAcceptance(task) {
  const acceptance = clean(task.acceptance_criteria);
  const done = clean(task.definition_of_done);
  if (!acceptance || !done) return false;
  if (acceptance !== done) return false;
  return !acceptance.includes("\n") && !acceptance.startsWith("-");
}

function dodFor(task) {
  const done = clean(task.definition_of_done);
  if (done && !isPlaceholder(done)) return done;
  const description = firstSentence(task.description);
  return ensurePeriod(description || `Die Aufgabe \"${clean(task.title)}\" ist umgesetzt, dokumentiert und reviewbar.`);
}

function outcomeFor(task) {
  const done = firstSentence(task.definition_of_done);
  if (done && !isPlaceholder(done)) return ensurePeriod(done);
  const description = firstSentence(task.description);
  return ensurePeriod(description || `Ein klar pr\u00fcfbares Ergebnis f\u00fcr \"${clean(task.title)}\" liegt vor.`);
}

function problemFor(task) {
  const existing = clean(task.problem_statement);
  if (existing && !isPlaceholder(existing)) return existing;
  const description = clean(task.description);
  return trimText(description || `Diese Aufgabe kl\u00e4rt oder liefert \"${clean(task.title)}\" f\u00fcr die operative Founder-Planung.`);
}

function buildPatch(task) {
  const patch = {};

  if (isPlaceholder(task.problem_statement)) patch.problem_statement = problemFor(task);
  if (isPlaceholder(task.intended_outcome)) patch.intended_outcome = outcomeFor(task);
  if (isPlaceholder(task.scope_constraints)) patch.scope_constraints = scopeFor(task);
  if (isPlaceholder(task.acceptance_criteria) || isWeakAcceptance(task)) patch.acceptance_criteria = acceptanceFor(task);
  if (isPlaceholder(task.evidence_required)) patch.evidence_required = clean(task.evidence_link) || evidenceLabel(task);
  if (isPlaceholder(task.definition_of_done)) patch.definition_of_done = dodFor(task);
  if (clean(task.dod_template_version) !== "founder-deliverable-v2") patch.dod_template_version = "founder-deliverable-v2";

  return patch;
}

function hasSuspiciousReplacement(value) {
  const text = clean(value);
  return /[A-Za-z\u00c4\u00d6\u00dc\u00e4\u00f6\u00fc\u00df]\?[A-Za-z\u00c4\u00d6\u00dc\u00e4\u00f6\u00fc\u00df]/.test(text);
}

const { data: tasks, error } = await supabase
  .from("tasks")
  .select("id,title,description,status,priority,owner,assignee,workstream,start_date,end_date,deadline,definition_of_done,evidence_link,problem_statement,intended_outcome,scope_constraints,acceptance_criteria,evidence_required,dod_template_version,issue_number,issue_url")
  .order("sort_order", { ascending: true });

if (error) {
  console.error(error.message);
  process.exit(1);
}

const patches = tasks
  .map((task) => ({ task, patch: buildPatch(task) }))
  .filter(({ patch }) => Object.keys(patch).length > 0);

if (SHOW_ID) {
  const task = tasks.find((candidate) => candidate.id === SHOW_ID);
  if (!task) {
    console.error(`Task not found: ${SHOW_ID}`);
    process.exit(1);
  }
  console.log(JSON.stringify({
    id: task.id,
    title: task.title,
    problem_statement: task.problem_statement,
    intended_outcome: task.intended_outcome,
    scope_constraints: task.scope_constraints,
    acceptance_criteria: task.acceptance_criteria,
    evidence_required: task.evidence_required,
    definition_of_done: task.definition_of_done,
    dod_template_version: task.dod_template_version,
  }, null, 2));
}

const suspicious = [];
for (const { task, patch } of patches) {
  for (const [field, value] of Object.entries(patch)) {
    if (hasSuspiciousReplacement(value)) suspicious.push({ id: task.id, field, value });
  }
}

if (suspicious.length) {
  console.error("Refusing to write suspicious replacement characters:");
  console.error(JSON.stringify(suspicious, null, 2));
  process.exit(1);
}

const summary = {
  mode: APPLY ? "apply" : "dry-run",
  totalTasks: tasks.length,
  tasksNeedingUpdate: patches.length,
  fieldCounts: patches.reduce((counts, { patch }) => {
    for (const field of Object.keys(patch)) counts[field] = (counts[field] || 0) + 1;
    return counts;
  }, {}),
  sample: patches.slice(0, 5).map(({ task, patch }) => ({
    id: task.id,
    title: task.title,
    fields: Object.keys(patch),
  })),
};

console.log(JSON.stringify(summary, null, 2));

if (!APPLY) {
  console.log("Dry-run only. Run `node scripts/backfill-task-template-v2.mjs --apply` to write changes.");
} else {
  await mkdir(resolve(process.cwd(), "docs"), { recursive: true });
  const backupPath = resolve(
    process.cwd(),
    "docs",
    `task-template-v2-backfill-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
  );
  await writeFile(backupPath, JSON.stringify(tasks, null, 2), "utf8");

  for (const { task, patch } of patches) {
    const { error: updateError } = await supabase.from("tasks").update(patch).eq("id", task.id);
    if (updateError) throw new Error(`${task.id}: ${updateError.message}`);
  }

  console.log(`Updated ${patches.length} tasks.`);
  console.log(`Backup written to ${backupPath}`);
}
