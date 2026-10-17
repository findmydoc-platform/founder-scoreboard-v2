import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

export function verifyClientCredentialBundle(root) {
  const directory = path.join(root, ".next/static");
  const files = [];
  function visit(folder) {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const file = path.join(folder, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (/\.(?:js|map)$/.test(entry.name)) files.push(file);
    }
  }
  try { if (statSync(directory).isDirectory()) visit(directory); } catch { /* Missing builds fail the gate below. */ }
  if (!files.length) return { files: 0, bytes: 0, failures: ["Production client chunks are missing."] };
  const markers = ["SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEY", "GITHUB_APP_PRIVATE_KEY", "GITHUB_APP_CLIENT_SECRET", "GITHUB_TOKEN_ENCRYPTION_KEY", "GOOGLE_WORKSPACE_CLIENT_SECRET", "GOOGLE_WORKSPACE_TOKEN_ENCRYPTION_KEY", "GOOGLE_CHAT_PRIVATE_KEY", "NOTION_TOKEN", "access_token", "refresh_token", "GoTrueClient", "@supabase/auth-js", "workspace_issue_permit", "workspace_release_permit", "synthetic-service"];
  const failures = [];
  let bytes = 0;
  for (const file of files) {
    const content = readFileSync(file); bytes += content.length;
    const text = content.toString("utf8"), name = path.relative(root, file).split(path.sep).join("/");
    for (const marker of markers) if (text.includes(marker)) failures.push(`${name}: server credential marker ${marker}`);
    if (/credentials[\\/]internal[\\/](?!browser-session)/.test(text)) failures.push(`${name}: server credential adapter source`);
  }
  return { files: files.length, bytes, failures };
}
