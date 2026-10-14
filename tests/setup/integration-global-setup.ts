import {
  isLocalSupabaseRunning,
  resetCurrentLocalDatabase,
  runLocalSupabase,
} from "./local-supabase";

export default async function setupIntegrationEnvironment() {
  const wasRunning = await isLocalSupabaseRunning();
  if (!wasRunning) await runLocalSupabase(["start", "--yes"]);
  await resetCurrentLocalDatabase();

  return async () => {
    if (!wasRunning) await runLocalSupabase(["stop", "--yes"]);
  };
}
