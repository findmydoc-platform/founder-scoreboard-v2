/** PROTOTYPE — interactive shell for Wayfinder #286. */
import {
  InMemoryPlanningItemsStore,
  SupabaseRpcPlanningItemsStorePrototype,
  revisionPlan,
  type PlanningItemsStore,
  type PlanningStoreResult,
} from "./planning-items-store.prototype.mts";

const bold = "\x1b[1m";
const dim = "\x1b[2m";
const reset = "\x1b[0m";

type DebugStore = PlanningItemsStore & { debugState(): unknown };
let adapter: "memory" | "supabase" = "memory";
let store: DebugStore = new InMemoryPlanningItemsStore();
let lastResult: PlanningStoreResult | Record<string, unknown> | null = null;

function resetStore() {
  store = adapter === "memory"
    ? new InMemoryPlanningItemsStore()
    : new SupabaseRpcPlanningItemsStorePrototype();
  lastResult = null;
}

async function runEquivalence() {
  const memory = new InMemoryPlanningItemsStore();
  const supabase = new SupabaseRpcPlanningItemsStorePrototype();
  const plan = revisionPlan({ title: "Equivalent title", key: "equivalent-1" });
  const [memoryResult, supabaseResult] = await Promise.all([memory.commit(plan), supabase.commit(plan)]);
  const memoryObserved = { result: memoryResult, state: memory.debugState() };
  const supabaseObserved = { result: supabaseResult, state: supabase.debugState() };
  lastResult = {
    equivalent: JSON.stringify(memoryObserved) === JSON.stringify(supabaseObserved),
    memory: memoryObserved,
    supabase: supabaseObserved,
  };
}

async function runScenarios() {
  const replayStore = new InMemoryPlanningItemsStore();
  const replayPlan = revisionPlan({ title: "Committed title" });
  const preparation = {
    commandKind: "reviseItem" as const,
    itemIds: ["deliverable-1"],
    replay: { principalId: "token-1", key: "revision-1" },
  };
  const preparedState = await replayStore.prepare(preparation);
  const first = await replayStore.commit(replayPlan);
  const preparedReplay = await replayStore.prepare(preparation);
  const replay = await replayStore.commit(replayPlan);
  const conflict = await replayStore.commit(revisionPlan({ title: "Different payload" }));

  const failureStore = new InMemoryPlanningItemsStore();
  const beforeFailure = failureStore.debugState();
  const failure = await failureStore.commit(
    revisionPlan({ title: "Must roll back", key: "failure-1", fail: true }),
  );

  await runEquivalence();
  lastResult = {
    preparedState,
    first,
    preparedReplay,
    replay,
    conflict,
    rollbackPreserved: JSON.stringify(beforeFailure) === JSON.stringify(failureStore.debugState()),
    failure,
    equivalence: lastResult,
  };
}

async function handle(key: string) {
  if (key === "a") {
    adapter = adapter === "memory" ? "supabase" : "memory";
    resetStore();
  }
  if (key === "c") lastResult = await store.commit(revisionPlan({ title: "Committed title" }));
  if (key === "r") lastResult = await store.commit(revisionPlan({ title: "Committed title" }));
  if (key === "i") lastResult = await store.commit(revisionPlan({ title: "Different payload", key: "revision-1" }));
  if (key === "f") lastResult = await store.commit(revisionPlan({ title: "Must roll back", key: "failure-1", fail: true }));
  if (key === "x") await runEquivalence();
  if (key === "n") resetStore();
}

function render(clear = true) {
  if (clear) console.clear();
  console.log(`${bold}PlanningItemsStore — PROTOTYPE${reset}`);
  console.log(`${dim}Question: prepare + one atomic commit, same observable result?${reset}`);
  console.log(`\n${bold}Adapter${reset}\n${adapter}`);
  console.log(`\n${bold}Persistent state${reset}`);
  console.log(JSON.stringify(store.debugState(), null, 2));
  console.log(`\n${bold}Last result${reset}`);
  console.log(lastResult ? JSON.stringify(lastResult, null, 2) : `${dim}none${reset}`);
  console.log(`\n${bold}Keys${reset}`);
  console.log("[a] adapter  [c] commit  [r] replay  [i] idempotency conflict");
  console.log("[f] injected failure/rollback  [x] equivalence  [n] reset  [q] quit");
}

if (!process.stdin.isTTY) {
  await runScenarios();
  render(false);
  process.exit(0);
}

process.stdin.setRawMode(true);
process.stdin.setEncoding("utf8");
process.stdin.resume();
render();
process.stdin.on("data", async (key: string) => {
  if (key === "q" || key === "\u0003") process.exit(0);
  await handle(key);
  render();
});
