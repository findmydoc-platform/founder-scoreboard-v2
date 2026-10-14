import {
  isLocalSupabaseRunning,
  resetCurrentLocalDatabase,
  runLocalSupabase,
} from "./local-supabase";

export default async function setupMigrationEnvironment() {
  const wasRunning = await isLocalSupabaseRunning();
  if (!wasRunning) await runLocalSupabase(["start", "--yes"]);

  return async () => {
    await resetCurrentLocalDatabase();
    if (!wasRunning) await runLocalSupabase(["stop", "--yes"]);
  };
}
