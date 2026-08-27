import { spawn } from "node:child_process";
import path from "node:path";

const supabaseCli = path.resolve(process.cwd(), "node_modules", ".bin", "supabase");

function runSupabase(args: string[], stdio: "ignore" | "inherit" = "inherit") {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(supabaseCli, args, { stdio });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      const reason = signal ? `signal ${signal}` : `exit code ${code ?? "unknown"}`;
      reject(new Error(`Local Supabase command failed with ${reason}.`));
    });
  });
}

async function isLocalSupabaseRunning() {
  try {
    await runSupabase(["status", "--output", "json"], "ignore");
    return true;
  } catch {
    return false;
  }
}

export default async function setupIntegrationEnvironment() {
  const wasRunning = await isLocalSupabaseRunning();
  if (!wasRunning) await runSupabase(["start", "--yes"]);

  return async () => {
    if (!wasRunning) await runSupabase(["stop", "--yes"]);
  };
}
