import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const legacyRoot = resolve(root, "..", "docs", "findmydoc");
const htmlPath = join(legacyRoot, "founder-task-dashboard.html");
const statePath = join(legacyRoot, "dashboard-state.json");
const outDir = join(root, "src", "lib", "generated");
const supabaseDir = join(root, "supabase");

function extractConst(source, name) {
  const start = source.indexOf(`const ${name} = `);
  if (start < 0) throw new Error(`Could not find const ${name}`);
  const arrayStart = source.indexOf("[", start);
  let depth = 0;
  let inString = false;
  let quote = "";
  let escaped = false;

  for (let index = arrayStart; index < source.length; index += 1) {
    const char = source[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        inString = false;
      }
      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      inString = true;
      quote = char;
      continue;
    }

    if (char === "[") depth += 1;
    if (char === "]") depth -= 1;
    if (depth === 0) return source.slice(arrayStart, index + 1);
  }

  throw new Error(`Could not parse const ${name}`);
}

function evaluateArray(source, name) {
  const text = extractConst(source, name);
  return vm.runInNewContext(`(${text})`, {}, { timeout: 1000 });
}

function slugify(value) {
  return String(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function keyForTask(task) {
  return `${slugify(task.owner)}-${slugify(task.task)}`;
}

function sql(value) {
  if (value === null || value === undefined || value === "") return "null";
  return `'${String(value).replaceAll("'", "''")}'`;
}

function hoursFor(task) {
  const text = `${task.task} ${task.detail} ${task.dod}`.toLowerCase();
  if (task.p === "P0") return 6;
  if (text.includes("review") || text.includes("prüfen")) return 3;
  if (text.includes("template") || text.includes("brief")) return 2;
  return 4;
}

function statusFor(task, state) {
  return state.taskStatuses?.[keyForTask(task)] || state.taskStatuses?.[slugify(task.task)] || "Offen";
}

function ownerFor(task, state) {
  return state.taskOwnerOverrides?.[keyForTask(task)] || task.owner;
}

function packageFor(task, commitments) {
  if (task.commitmentId) return task.commitmentId;
  if (["MVP", "Legal", "Legal / Company"].includes(task.workstream)) return "GC1";
  if (task.workstream === "Klinikpipeline" || task.task.includes("Bookimed") || task.task.includes("Expo")) return "GC2";
  if (["Investor", "Funding", "Pitchdeck"].includes(task.workstream) || task.task.includes("Malta Enterprise")) return "GC3";
  if (task.workstream.includes("Company") || task.workstream === "CRM/Notion") return "GC4";
  if (["Marketing", "Research"].includes(task.workstream)) return "GC5";
  return commitments[0]?.id || "GC1";
}

function estimateWindow(index) {
  const start = new Date(Date.UTC(2026, 4, 25 + Math.floor(index / 3) * 2));
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 2);
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
}

const html = await readFile(htmlPath, "utf8");
const state = existsSync(statePath) ? JSON.parse(await readFile(statePath, "utf8")) : {};
const people = evaluateArray(html, "people");
const commitments = evaluateArray(html, "commitments");
const tasks = evaluateArray(html, "tasks");

const profiles = people.map((person, index) => ({
  id: slugify(person.name),
  name: person.name,
  role: index === 0 ? "admin" : "member",
  platformRole: index === 0 ? "ceo" : "founder",
  orgRole: index === 0 ? "CEO" : "Founder",
  githubLogin: "",
  focus: person.focus,
  weeklyCapacity: state.capacity?.[person.name] ?? 6,
}));

const packages = commitments.map((commitment, index) => ({
  id: commitment.id,
  title: commitment.title,
  goal: commitment.goal,
  priority: commitment.priority,
  sortOrder: index + 1,
}));

const planningTasks = tasks.map((task, index) => {
  const owner = ownerFor(task, state);
  const issue = state.taskIssues?.[keyForTask(task)] || {};
  const note = state.taskNotes?.[keyForTask(task)] || "";
  return {
    id: keyForTask(task),
    order: Number.isFinite(task.order) ? task.order : index + 1,
    title: task.task,
    description: task.detail,
    status: statusFor(task, state),
    priority: task.p,
    owner,
    assignee: owner,
    workstream: task.workstream,
    packageId: packageFor(task, commitments),
    deadline: task.deadline,
    definitionOfDone: task.dod,
    dependsOn: task.dependsOn || "",
    evidenceLink: task.evidenceLink || "",
    issueNumber: issue.number || "",
    issueUrl: issue.url || "",
    note,
    watched: Boolean(state.taskWatch?.[keyForTask(task)]),
    hours: hoursFor(task),
    sprintId: "sprint-1",
    reviewStatus: "not_requested",
    scorePoints: 0,
    scoreFinal: false,
    githubRepo: "findmydoc-platform/management",
    githubIssueNumber: issue.number ? Number(issue.number) : null,
    githubIssueUrl: issue.url || "",
    githubSyncStatus: issue.url ? "synced" : "not_synced",
    githubLastSyncedAt: "",
    githubSyncError: "",
    taskType: "deliverable",
    parentTaskId: "",
    scoreRelevant: true,
    ...estimateWindow(index),
  };
});

await mkdir(outDir, { recursive: true });
await mkdir(supabaseDir, { recursive: true });

await writeFile(
  join(outDir, "seed-data.ts"),
  `import type { PlanningData } from "../types";\n\nexport const seedData: PlanningData = ${JSON.stringify(
    {
      project: {
        id: "findmydoc-founder-execution",
        name: "findmydoc Founder Execution",
        range: "Sprint 1 / operative Planungsphase",
      },
      profiles,
      packages,
      tasks: planningTasks,
      sprints: [
        {
          id: "sprint-1",
          name: "Sprint 1",
          status: "active",
          startDate: "2026-05-25",
          endDate: "2026-06-07",
          reviewDueAt: "2026-06-05T12:00:00.000Z",
          scoreLocked: false,
        },
      ],
      sprintCommitments: [],
      decisions: [],
      decisionComments: [],
      taskComments: [],
      taskBlockers: [],
      notificationEvents: [],
      meetings: [
        {
          id: 1,
          sprintId: "sprint-1",
          title: "Sprint 1 Biweekly",
          meetingAt: "2026-06-07T18:00:00.000Z",
          status: "planned",
          agenda: "Sprint-Update, Blocker, Review-Stand, Entscheidungen und nächste Sprintplanung.",
        },
      ],
      meetingAttendance: [],
      audit: [],
      availability: [],
    },
    null,
    2,
  )};\n`,
  "utf8",
);

const schema = `create table if not exists profiles (
  id text primary key,
  auth_user_id uuid unique references auth.users(id) on delete set null,
  name text not null,
  role text not null check (role in ('admin', 'member', 'viewer')),
  focus text,
  weekly_capacity integer not null default 6
);

create table if not exists projects (
  id text primary key,
  name text not null,
  range_label text
);

create table if not exists packages (
  id text primary key,
  project_id text not null references projects(id) on delete cascade,
  title text not null,
  goal text,
  priority text,
  sort_order integer not null default 0
);

create table if not exists tasks (
  id text primary key,
  project_id text not null references projects(id) on delete cascade,
  package_id text references packages(id) on delete set null,
  title text not null,
  description text,
  status text not null,
  priority text not null,
  owner text references profiles(id) on delete set null,
  assignee text references profiles(id) on delete set null,
  workstream text,
  sort_order integer not null default 0,
  start_date date,
  end_date date,
  deadline text,
  estimate_hours integer,
  definition_of_done text,
  evidence_link text,
  issue_number text,
  issue_url text,
  watched boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists task_dependencies (
  id bigint generated always as identity primary key,
  task_id text not null references tasks(id) on delete cascade,
  note text not null
);

create table if not exists task_links (
  id bigint generated always as identity primary key,
  task_id text not null references tasks(id) on delete cascade,
  type text not null,
  label text not null,
  url text not null
);

create table if not exists task_notes (
  task_id text primary key references tasks(id) on delete cascade,
  note text not null,
  updated_at timestamptz not null default now()
);

create table if not exists task_activity (
  id bigint generated always as identity primary key,
  task_id text not null references tasks(id) on delete cascade,
  message text not null,
  created_at timestamptz not null default now()
);

create index if not exists profiles_auth_user_id_idx on profiles(auth_user_id);
create index if not exists packages_project_id_idx on packages(project_id);
create index if not exists tasks_project_id_idx on tasks(project_id);
create index if not exists tasks_package_id_idx on tasks(package_id);
create index if not exists tasks_status_idx on tasks(status);
create index if not exists tasks_owner_idx on tasks(owner);
create index if not exists task_dependencies_task_id_idx on task_dependencies(task_id);
create index if not exists task_links_task_id_idx on task_links(task_id);
create index if not exists task_activity_task_id_idx on task_activity(task_id);

grant usage on schema public to anon, authenticated, service_role;
grant select on profiles, projects, packages, tasks, task_dependencies, task_links, task_notes, task_activity to authenticated, service_role;
grant insert, update, delete on profiles, projects, packages, tasks, task_dependencies, task_links, task_notes, task_activity to authenticated, service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;

create or replace function public.current_profile_role()
returns text
language sql
security definer
set search_path = public
stable
as $$
  select role from public.profiles where auth_user_id = auth.uid()
$$;

alter table profiles enable row level security;
alter table projects enable row level security;
alter table packages enable row level security;
alter table tasks enable row level security;
alter table task_dependencies enable row level security;
alter table task_links enable row level security;
alter table task_notes enable row level security;
alter table task_activity enable row level security;

drop policy if exists "profiles_select_team" on profiles;
create policy "profiles_select_team" on profiles for select to authenticated using (auth.uid() is not null);

drop policy if exists "profiles_update_self_or_admin" on profiles;
create policy "profiles_update_self_or_admin" on profiles for update to authenticated
using (auth_user_id = auth.uid() or public.current_profile_role() = 'admin')
with check (auth_user_id = auth.uid() or public.current_profile_role() = 'admin');

drop policy if exists "projects_select_team" on projects;
create policy "projects_select_team" on projects for select to authenticated using (auth.uid() is not null);

drop policy if exists "projects_write_admin" on projects;
create policy "projects_write_admin" on projects for all to authenticated
using (public.current_profile_role() = 'admin')
with check (public.current_profile_role() = 'admin');

drop policy if exists "packages_select_team" on packages;
create policy "packages_select_team" on packages for select to authenticated using (auth.uid() is not null);

drop policy if exists "packages_write_members" on packages;
create policy "packages_write_members" on packages for all to authenticated
using (public.current_profile_role() in ('admin', 'member'))
with check (public.current_profile_role() in ('admin', 'member'));

drop policy if exists "tasks_select_team" on tasks;
create policy "tasks_select_team" on tasks for select to authenticated using (auth.uid() is not null);

drop policy if exists "tasks_write_members" on tasks;
create policy "tasks_write_members" on tasks for all to authenticated
using (public.current_profile_role() in ('admin', 'member'))
with check (public.current_profile_role() in ('admin', 'member'));

drop policy if exists "task_dependencies_select_team" on task_dependencies;
create policy "task_dependencies_select_team" on task_dependencies for select to authenticated using (auth.uid() is not null);

drop policy if exists "task_dependencies_write_members" on task_dependencies;
create policy "task_dependencies_write_members" on task_dependencies for all to authenticated
using (public.current_profile_role() in ('admin', 'member'))
with check (public.current_profile_role() in ('admin', 'member'));

drop policy if exists "task_links_select_team" on task_links;
create policy "task_links_select_team" on task_links for select to authenticated using (auth.uid() is not null);

drop policy if exists "task_links_write_members" on task_links;
create policy "task_links_write_members" on task_links for all to authenticated
using (public.current_profile_role() in ('admin', 'member'))
with check (public.current_profile_role() in ('admin', 'member'));

drop policy if exists "task_notes_select_team" on task_notes;
create policy "task_notes_select_team" on task_notes for select to authenticated using (auth.uid() is not null);

drop policy if exists "task_notes_write_members" on task_notes;
create policy "task_notes_write_members" on task_notes for all to authenticated
using (public.current_profile_role() in ('admin', 'member'))
with check (public.current_profile_role() in ('admin', 'member'));

drop policy if exists "task_activity_select_team" on task_activity;
create policy "task_activity_select_team" on task_activity for select to authenticated using (auth.uid() is not null);

drop policy if exists "task_activity_insert_members" on task_activity;
create policy "task_activity_insert_members" on task_activity for insert to authenticated
with check (public.current_profile_role() in ('admin', 'member'));
`;

const seedSql = [
  schema,
  `insert into projects (id, name, range_label) values ('findmydoc-founder-execution', 'findmydoc Founder Execution', 'Sprint 1 / operative Planungsphase') on conflict (id) do update set name = excluded.name, range_label = excluded.range_label;`,
  ...profiles.map(
    (profile) =>
      `insert into profiles (id, name, role, focus, weekly_capacity) values (${sql(profile.id)}, ${sql(profile.name)}, ${sql(profile.role)}, ${sql(profile.focus)}, ${profile.weeklyCapacity}) on conflict (id) do update set name = excluded.name, role = excluded.role, focus = excluded.focus, weekly_capacity = excluded.weekly_capacity;`,
  ),
  ...packages.map(
    (pack) =>
      `insert into packages (id, project_id, title, goal, priority, sort_order) values (${sql(pack.id)}, 'findmydoc-founder-execution', ${sql(pack.title)}, ${sql(pack.goal)}, ${sql(pack.priority)}, ${pack.sortOrder}) on conflict (id) do update set title = excluded.title, goal = excluded.goal, priority = excluded.priority, sort_order = excluded.sort_order;`,
  ),
  ...planningTasks.map(
    (task) =>
      `insert into tasks (id, project_id, package_id, title, description, status, priority, owner, assignee, workstream, sort_order, start_date, end_date, deadline, estimate_hours, definition_of_done, evidence_link, issue_number, issue_url, watched) values (${sql(task.id)}, 'findmydoc-founder-execution', ${sql(task.packageId)}, ${sql(task.title)}, ${sql(task.description)}, ${sql(task.status)}, ${sql(task.priority)}, ${sql(slugify(task.owner))}, ${sql(slugify(task.assignee))}, ${sql(task.workstream)}, ${task.order}, ${sql(task.startDate)}, ${sql(task.endDate)}, ${sql(task.deadline)}, ${task.hours}, ${sql(task.definitionOfDone)}, ${sql(task.evidenceLink)}, ${sql(task.issueNumber)}, ${sql(task.issueUrl)}, ${task.watched}) on conflict (id) do update set package_id = excluded.package_id, title = excluded.title, description = excluded.description, status = excluded.status, priority = excluded.priority, owner = excluded.owner, assignee = excluded.assignee, workstream = excluded.workstream, sort_order = excluded.sort_order, start_date = excluded.start_date, end_date = excluded.end_date, deadline = excluded.deadline, estimate_hours = excluded.estimate_hours, definition_of_done = excluded.definition_of_done, evidence_link = excluded.evidence_link, issue_number = excluded.issue_number, issue_url = excluded.issue_url, watched = excluded.watched;`,
  ),
  `delete from task_dependencies where task_id in (${planningTasks.map((task) => sql(task.id)).join(", ")});`,
  `delete from task_links where task_id in (${planningTasks.map((task) => sql(task.id)).join(", ")});`,
  ...planningTasks
    .filter((task) => task.dependsOn)
    .map(
      (task) =>
        `insert into task_dependencies (task_id, note) values (${sql(task.id)}, ${sql(task.dependsOn)});`,
    ),
  ...planningTasks.flatMap((task) => {
    const links = [];
    if (task.evidenceLink) links.push({ type: "evidence", label: "Evidence", url: task.evidenceLink });
    if (task.issueUrl) links.push({ type: "github", label: task.issueNumber ? `GitHub #${task.issueNumber}` : "GitHub", url: task.issueUrl });
    return links.map(
      (link) =>
        `insert into task_links (task_id, type, label, url) values (${sql(task.id)}, ${sql(link.type)}, ${sql(link.label)}, ${sql(link.url)});`,
    );
  }),
  ...planningTasks
    .filter((task) => task.note)
    .map((task) => `insert into task_notes (task_id, note) values (${sql(task.id)}, ${sql(task.note)}) on conflict (task_id) do update set note = excluded.note;`),
].join("\n\n");

await writeFile(join(supabaseDir, "schema.sql"), schema, "utf8");
await writeFile(join(supabaseDir, "seed.sql"), seedSql, "utf8");

console.log(`Imported ${profiles.length} profiles, ${packages.length} packages and ${planningTasks.length} tasks.`);
