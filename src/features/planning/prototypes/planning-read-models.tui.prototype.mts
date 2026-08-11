/** PROTOTYPE — interactive shell for Wayfinder #288. */
import {
  importAttempts,
  loadReadModel,
  loadShell,
  prototypeSummary,
  readModelNames,
  source,
  validateImport,
} from "./planning-read-models.prototype.mts";

const bold = "\x1b[1m";
const dim = "\x1b[2m";
const reset = "\x1b[0m";

let modelIndex = 0;
let importIndex = 0;

function render(clear = true) {
  if (clear) console.clear();
  const name = readModelNames[modelIndex];
  const model = loadReadModel(name, source);
  const checkedImport = validateImport(importAttempts[importIndex]);

  console.log(`${bold}Application Read Models — PROTOTYPE${reset}`);
  console.log(`${dim}Consumer-owned models instead of one 28-field container${reset}`);
  console.log(`\n${bold}Shared shell${reset}`);
  console.log(JSON.stringify(loadShell(source), null, 2));
  console.log(`\n${bold}Selected model: ${name}${reset}`);
  console.log(JSON.stringify(model, null, 2));
  console.log(`\n${bold}Fields present${reset}`);
  console.log(Object.keys(model).join(", "));
  console.log(`\n${bold}Import check${reset}`);
  console.log(JSON.stringify(checkedImport, null, 2));
  console.log(`\n${bold}Keys${reset}`);
  console.log("[m] next read model  [i] next import attempt  [q] quit");
}

if (!process.stdin.isTTY) {
  console.log(JSON.stringify(prototypeSummary(source), null, 2));
  process.exit(0);
}

process.stdin.setRawMode(true);
process.stdin.setEncoding("utf8");
process.stdin.resume();
render();
process.stdin.on("data", (key: string) => {
  if (key === "q" || key === "\u0003") process.exit(0);
  if (key === "m") modelIndex = (modelIndex + 1) % readModelNames.length;
  if (key === "i") importIndex = (importIndex + 1) % importAttempts.length;
  render();
});
