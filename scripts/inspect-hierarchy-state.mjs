import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const envPath = resolve(process.cwd(), ".env.local");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    process.env[match[1]] ||= match[2].replace(/^["']|["']$/g, "");
  }
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!supabaseUrl || !supabaseKey) {
  console.error("Missing Supabase environment.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const [milestonesResult, initiativesResult, tasksResult] = await Promise.all([
  supabase.from("milestones").select("id,title,description,status,target_date,sort_order").order("sort_order"),
  supabase
    .from("packages")
    .select("id,title,goal,milestone_id,owner_id,priority,status,target_date,success_criteria,scope_constraints,sort_order")
    .order("sort_order"),
  supabase
    .from("tasks")
    .select("id,title,task_type,status,priority,owner,assignee,package_id,milestone_id,sprint_id,score_relevant,github_issue_number,github_issue_url,issue_number,issue_url,estimate_hours")
    .order("title"),
]);

for (const result of [milestonesResult, initiativesResult, tasksResult]) {
  if (result.error) {
    console.error(result.error);
    process.exit(1);
  }
}

const milestones = milestonesResult.data || [];
const initiatives = initiativesResult.data || [];
const tasks = tasksResult.data || [];
const milestoneById = new Map(milestones.map((milestone) => [milestone.id, milestone]));
const initiativeById = new Map(initiatives.map((initiative) => [initiative.id, initiative]));
const deliverables = tasks.filter((task) => task.task_type === "deliverable" || !task.task_type);
const subIssues = tasks.filter((task) => task.task_type === "sub_issue");
const appOnly = tasks.filter((task) => !(task.github_issue_number || task.github_issue_url || task.issue_number || task.issue_url));

function taskSummary(task) {
  const initiative = task.package_id ? initiativeById.get(task.package_id) : null;
  const milestone = task.milestone_id
    ? milestoneById.get(task.milestone_id)
    : initiative?.milestone_id
      ? milestoneById.get(initiative.milestone_id)
      : null;
  return {
    title: task.title,
    type: task.task_type || "deliverable",
    status: task.status,
    priority: task.priority,
    owner: task.owner,
    assignee: task.assignee,
    initiative: initiative?.title || task.package_id || null,
    milestone: milestone?.title || task.milestone_id || null,
    sprint: task.sprint_id,
    appOnly: !(task.github_issue_number || task.github_issue_url || task.issue_number || task.issue_url),
    hours: task.estimate_hours,
  };
}

const result = {
  counts: {
    milestones: milestones.length,
    initiatives: initiatives.length,
    tasks: tasks.length,
    deliverables: deliverables.length,
    subIssues: subIssues.length,
    appOnly: appOnly.length,
  },
  missing: {
    initiativesWithoutMilestone: initiatives
      .filter((initiative) => !initiative.milestone_id)
      .map((initiative) => initiative.title || initiative.id),
    deliverablesWithoutInitiative: deliverables.filter((task) => !task.package_id).map(taskSummary),
    deliverablesWithUnknownInitiative: deliverables
      .filter((task) => task.package_id && !initiativeById.has(task.package_id))
      .map(taskSummary),
    tasksWithUnknownMilestone: tasks.filter((task) => task.milestone_id && !milestoneById.has(task.milestone_id)).map(taskSummary),
  },
  initiatives: initiatives.map((initiative) => {
    const children = deliverables.filter((task) => task.package_id === initiative.id);
    return {
      id: initiative.id,
      name: initiative.title,
      milestone: milestoneById.get(initiative.milestone_id)?.title || null,
      ownerId: initiative.owner_id,
      priority: initiative.priority,
      status: initiative.status,
      deliverables: children.length,
      openDeliverables: children.filter((task) => task.status !== "Erledigt").length,
      hours: children.reduce((sum, task) => sum + Number(task.estimate_hours || 0), 0),
    };
  }),
  appOnly: appOnly.map(taskSummary),
};

console.log(JSON.stringify(result, null, 2));
