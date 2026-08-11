/** PROTOTYPE — interactive shell for Wayfinder #285. */
import { initialState, runPlanningCommand, type ActorContext, type PlanningCommand, type PlanningResult, type PrototypeState } from "./planning-command-interface.prototype.mts";

const bold = "\x1b[1m";
const dim = "\x1b[2m";
const reset = "\x1b[0m";

const actors: Record<"ceo" | "founder" | "token", ActorContext> = {
  ceo: { profileId: "ceo", platformRole: "ceo", credential: { kind: "session" } },
  founder: { profileId: "founder", platformRole: "founder", credential: { kind: "session" } },
  token: { profileId: "founder", platformRole: "founder", credential: { kind: "planningToken", tokenId: "token-1", scopes: ["write:planning-items:update"] } },
};

let state: PrototypeState = initialState();
let actorKey: keyof typeof actors = "ceo";
let mode: "preview" | "commit" = "preview";
let sequence = 1;
let lastResult: PlanningResult | null = null;

function invoke(command: PlanningCommand) {
  const outcome = runPlanningCommand(state, {
    actor: actors[actorKey],
    mode,
    command,
    idempotencyKey: actorKey === "token" ? `prototype-${sequence++}` : undefined,
  });
  state = outcome.state;
  lastResult = outcome.result;
}

function render(clear = true) {
  if (clear) console.clear();
  console.log(`${bold}Planning Items command interface — PROTOTYPE${reset}`);
  console.log(`${dim}Question: one run seam + three command families + stable result union?${reset}`);
  console.log(`\n${bold}Invocation${reset}`);
  console.log(`actor: ${actorKey}  mode: ${mode}`);
  console.log(`\n${bold}State${reset}`);
  console.log(JSON.stringify(state, null, 2));
  console.log(`\n${bold}Last result${reset}`);
  console.log(lastResult ? JSON.stringify(lastResult, null, 2) : `${dim}none${reset}`);
  console.log(`\n${bold}Keys${reset}`);
  console.log("[m] mode  [x] actor  [c] create  [u] revise  [a] approve");
  console.log("[w] withdraw  [r] restore  [d] delete epic  [g] project  [q] quit");
}

function handle(key: string) {
  if (key === "m") mode = mode === "preview" ? "commit" : "preview";
  if (key === "x") actorKey = actorKey === "ceo" ? "founder" : actorKey === "founder" ? "token" : "ceo";
  if (key === "c") invoke({ kind: "createItems", items: [{ id: `deliverable-${sequence++}`, kind: "deliverable", title: "Prototype item", ownerId: "founder", parentId: "initiative-1", approval: "proposed", status: "open" }] });
  if (key === "u") invoke({ kind: "reviseItem", itemId: "deliverable-1", expectedRevision: state.items.find((item) => item.id === "deliverable-1")?.revision || 1, changes: { title: "Revised runbook" } });
  if (key === "a") invoke({ kind: "actOnItem", itemId: "initiative-1", expectedRevision: state.items.find((item) => item.id === "initiative-1")?.revision || 1, action: { type: "decideApproval", decision: "approve" } });
  if (key === "w") invoke({ kind: "actOnItem", itemId: "deliverable-1", expectedRevision: state.items.find((item) => item.id === "deliverable-1")?.revision || 1, action: { type: "withdraw" } });
  if (key === "r") invoke({ kind: "actOnItem", itemId: "deliverable-1", expectedRevision: state.items.find((item) => item.id === "deliverable-1")?.revision || 1, action: { type: "restore" } });
  if (key === "d") invoke({ kind: "actOnItem", itemId: "epic-1", expectedRevision: state.items.find((item) => item.id === "epic-1")?.revision || 1, action: { type: "deleteEmptyEpic" } });
  if (key === "g") invoke({ kind: "actOnItem", itemId: "deliverable-1", expectedRevision: state.items.find((item) => item.id === "deliverable-1")?.revision || 1, action: { type: "requestIssueProjection", createIfMissing: true } });
}

if (!process.stdin.isTTY) {
  for (const key of ["u", "m", "u", "a", "g", "d"]) handle(key);
  render(false);
  process.exit(0);
}

process.stdin.setRawMode(true);
process.stdin.setEncoding("utf8");
process.stdin.resume();
render();
process.stdin.on("data", (key: string) => {
  if (key === "q" || key === "\u0003") process.exit(0);
  handle(key);
  render();
});
