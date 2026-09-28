import pg from "pg";
import { resolveProductionSchemaConnection } from "../../../scripts/lib/production-schema-connection.mjs";

if (process.env.SCHEMA_DEPLOY_TARGET !== "production" || process.env.GITHUB_REF !== "refs/heads/main") {
  throw new Error("Production linking activation requires the main deployment workflow.");
}

const dryRun = process.argv.includes("--dry-run");
const client = new pg.Client(resolveProductionSchemaConnection(process.env));
await client.connect();
try {
  await client.query("begin");
  const state = await client.query("select mode, linking_enforced from workspace_private.configuration where singleton for update");
  if (state.rowCount !== 1 || !["linking", "google"].includes(state.rows[0].mode)) {
    throw new Error("Workspace linking mode is unavailable.");
  }
  if (state.rows[0].mode === "linking" && !state.rows[0].linking_enforced) {
    await client.query("update workspace_private.configuration set linking_enforced = true where singleton and mode = $1", ["linking"]);
  }
  await client.query(dryRun ? "rollback" : "commit");
  console.log(dryRun ? "Workspace linking activation dry run passed." : "Workspace linking enforcement is active.");
} catch (error) {
  await client.query("rollback").catch(() => undefined);
  throw error;
} finally {
  await client.end();
}
