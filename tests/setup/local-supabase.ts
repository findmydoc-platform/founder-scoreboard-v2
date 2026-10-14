import { spawn } from "node:child_process";
import path from "node:path";

const supabaseCli = path.resolve(process.cwd(), "node_modules", ".bin", "supabase");

export function runLocalSupabase(
  args: string[],
  { quiet = false }: { quiet?: boolean } = {},
) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(supabaseCli, args, {
      stdio: quiet ? ["ignore", "ignore", "pipe"] : "inherit",
    });
    let stderr = "";

    if (quiet && child.stderr) {
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
    }

    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      const reason = signal ? `signal ${signal}` : `exit code ${code ?? "unknown"}`;
      const details = quiet && stderr.trim() ? ` ${stderr.trim()}` : "";
      reject(new Error(`Local Supabase command failed with ${reason}.${details}`));
    });
  });
}

export async function isLocalSupabaseRunning() {
  try {
    await runLocalSupabase(["status", "--output", "json"], { quiet: true });
    return true;
  } catch {
    return false;
  }
}

export function resetCurrentLocalDatabase() {
  return runLocalSupabase(["db", "reset", "--local", "--no-seed"], { quiet: true });
}
