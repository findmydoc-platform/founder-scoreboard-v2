import { createSupabaseScriptClient } from "./lib/supabase.mjs";
import { normalizeWordsWithoutQuotes } from "./lib/text-normalization.mjs";

const supabase = await createSupabaseScriptClient({
  missingMessage: "Missing Supabase env. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
  clientOptions: {},
});

function normalize(value) {
  return normalizeWordsWithoutQuotes(value);
}

function tokens(value) {
  return new Set(normalize(value).split(" ").filter((token) => token.length > 2));
}

function splitDependencyNote(note) {
  return note
    .split(";")
    .flatMap((part) => part.split(/\s+\+\s+/))
    .map((part) => part.trim())
    .filter(Boolean);
}

function stripOwnerPrefix(value) {
  const match = value.match(/^([^:]+):\s*(.+)$/);
  if (!match) return { ownerHint: "", text: value };
  return { ownerHint: normalize(match[1]), text: match[2].trim() };
}

function scoreCandidate(text, ownerHint, task) {
  const queryTokens = tokens(text);
  const titleTokens = tokens(task.title);
  let overlap = 0;
  for (const token of queryTokens) {
    if (titleTokens.has(token)) overlap += 1;
  }

  const normalizedText = normalize(text);
  const normalizedTitle = normalize(task.title);
  let score = overlap;
  if (normalizedTitle.includes(normalizedText) || normalizedText.includes(normalizedTitle)) score += 8;
  if (ownerHint && normalize(task.owner) === ownerHint) score += 4;
  if (normalizedText.length < 8 && !normalizedTitle.includes(normalizedText)) score -= 3;
  return score;
}

const manualTargets = new Map([
  [
    "volkan-summit-follow-ups-vorbereiten-und-senden|volkan investorstatus",
    ["volkan-summit-investorenstatus-aktualisieren"],
  ],
  [
    "ozen-loi-und-graue-prospect-nutzung-zur-legal-prufung-vorbereiten|anil sebastian grey prospect regel csv",
    [
      "anil-crm-regel-fur-graue-prospects-anlegen",
      "sebastian-bookimed-crawler-daten-als-notion-csv-prospect-liste-bereitstellen",
    ],
  ],
]);

const manualUnmatched = new Set([
  "volkan-founder-output-impact-bericht-bis-biweekly-erstellen|alle founder evidence links",
  "volkan-founder-output-impact-bericht-bis-biweekly-erstellen|anil volkan notion outputs",
  "volkan-founder-output-impact-bericht-bis-biweekly-erstellen|sebastian volkan github outputs",
  "volkan-founder-output-impact-bericht-bis-biweekly-erstellen|manuelle evidence pro founder",
  "volkan-markenrechte-risiko-und-losungsbericht-findmydoc-erstellen|anil markenanmeldungsunterlagen",
  "volkan-markenrechte-risiko-und-losungsbericht-findmydoc-erstellen|ozen legal fragenliste fur marken ip anwalt",
  "ozen-malta-uk-deutschland-advisor-fragen-bundeln|volkan jurisdiction prioritat",
  "youssef-investor-e-mails-reviewen-und-template-erstellen|volkan sebastian ozen versendete investor e mails oder screenshots weiterleitungen bereitstellen",
]);

function addRelation(sourceTaskId, relatedTaskId, note) {
  const keyValue = `${sourceTaskId}:${relatedTaskId}:blocked_by`;
  if (seen.has(keyValue)) return;
  seen.add(keyValue);
  inserts.push({
    task_id: sourceTaskId,
    related_task_id: relatedTaskId,
    relation_type: "blocked_by",
    note,
    created_by: "volkan",
  });
}

const [{ data: tasks, error: taskError }, { data: dependencies, error: dependencyError }] = await Promise.all([
  supabase.from("tasks").select("id,title,owner,status,github_issue_number,github_issue_url").eq("project_id", "findmydoc-founder-execution"),
  supabase.from("task_dependencies").select("task_id,note"),
]);

if (taskError || dependencyError) {
  console.error(taskError?.message || dependencyError?.message);
  process.exit(1);
}

const taskById = new Map(tasks.map((task) => [task.id, task]));
const inserts = [];
const unmatched = [];
const seen = new Set();

for (const dependency of dependencies || []) {
  const sourceTask = taskById.get(dependency.task_id);
  if (!sourceTask || !dependency.note) continue;

  for (const part of splitDependencyNote(dependency.note)) {
    const { ownerHint, text } = stripOwnerPrefix(part);
    const manualKey = `${dependency.task_id}|${normalize(part)}`;

    if (manualUnmatched.has(manualKey)) {
      unmatched.push({ taskId: dependency.task_id, title: sourceTask.title, note: part, reason: "broad_or_ambiguous" });
      continue;
    }

    const manualTargetIds = manualTargets.get(manualKey);
    if (manualTargetIds) {
      for (const targetId of manualTargetIds) {
        if (taskById.has(targetId)) addRelation(dependency.task_id, targetId, part);
      }
      continue;
    }

    const candidates = tasks
      .filter((task) => task.id !== dependency.task_id)
      .map((task) => ({ task, score: scoreCandidate(text, ownerHint, task) }))
      .filter((candidate) => candidate.score >= 5)
      .sort((a, b) => b.score - a.score);

    const best = candidates[0];
    if (!best) {
      unmatched.push({ taskId: dependency.task_id, title: sourceTask.title, note: part });
      continue;
    }

    const secondBest = candidates[1];
    if (secondBest && secondBest.score === best.score) {
      unmatched.push({ taskId: dependency.task_id, title: sourceTask.title, note: part, reason: "ambiguous_match" });
      continue;
    }

    addRelation(dependency.task_id, best.task.id, part);
  }
}

const { error: deleteError } = await supabase.from("task_relationship_edges").delete().neq("id", 0);
if (deleteError) {
  console.error(deleteError.message);
  process.exit(1);
}

if (inserts.length) {
  const { error: insertError } = await supabase.from("task_relationship_edges").insert(inserts);
  if (insertError) {
    console.error(insertError.message);
    process.exit(1);
  }
}

console.log(JSON.stringify({
  created: inserts.length,
  unmatched: unmatched.length,
  unmatchedItems: unmatched,
  sample: inserts.slice(0, 12),
}, null, 2));
