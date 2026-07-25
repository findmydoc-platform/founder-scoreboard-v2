import pg from "pg";
import { verifyDatabaseSecurity } from "./lib/database-security.mjs";
import { resolveProductionSchemaConnection } from "./lib/production-schema-connection.mjs";

const [target, ...unexpectedArguments] = process.argv
  .slice(2)
  .filter((argument) => argument !== "--");
if (
  unexpectedArguments.length
  || !["--local", "--production"].includes(target)
) {
  throw new Error(
    "Choose exactly one database security target: --local or --production.",
  );
}

function connectionForTarget() {
  if (target === "--local") {
    return {
      host: "127.0.0.1",
      port: 54322,
      user: "postgres",
      password: "postgres",
      database: "postgres",
      ssl: false,
      connectionTimeoutMillis: 5_000,
      application_name: "founder-scoreboard-security-verifier-local",
    };
  }

  if (process.env.SCHEMA_DEPLOY_TARGET !== "production") {
    throw new Error(
      "Refusing production security verification: SCHEMA_DEPLOY_TARGET must be production.",
    );
  }
  if (process.env.GITHUB_REF !== "refs/heads/main") {
    throw new Error(
      "Refusing production security verification outside refs/heads/main.",
    );
  }

  return {
    ...resolveProductionSchemaConnection(process.env),
    connectionTimeoutMillis: 10_000,
    application_name: "founder-scoreboard-security-verifier-production",
  };
}

const client = new pg.Client(connectionForTarget());
await client.connect();

try {
  await client.query("begin read only");
  const result = await verifyDatabaseSecurity(client);
  await client.query("rollback");
  console.log(
    `Database security verified: ${result.publicTables} public tables use RLS; `
    + `${result.authenticatedFunctions} authenticated RPC helpers are exposed.`,
  );
} catch (error) {
  await client.query("rollback").catch(() => {});
  throw error;
} finally {
  await client.end();
}
