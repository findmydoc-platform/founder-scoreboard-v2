import { spawnSync as defaultSpawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const MACOS_SERVICE = "founderops-team-intake-token";
const WINDOWS_TARGET = "findmydoc/founderops-team-intake-token";
const TOKEN_PREFIX = "fmd_ti_";
const WINDOWS_SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "windows-credential-manager.ps1");

function processResult(spawnSync, command, args, options = {}) {
  try {
    return spawnSync(command, args, { encoding: "utf8", ...options });
  } catch {
    return { status: 1, stdout: "", stderr: "" };
  }
}

export function validateFounderOpsToken(value) {
  const token = String(value || "").trim();
  if (!token.startsWith(TOKEN_PREFIX)) {
    throw new Error("The stored credential is not a FounderOps Team Task Intake token.");
  }
  return token;
}

export function createCredentialStore({
  platform = process.platform,
  env = process.env,
  spawnSync = defaultSpawnSync,
  windowsScript = WINDOWS_SCRIPT,
} = {}) {
  if (platform !== "darwin" && platform !== "win32") {
    throw new Error(`FounderOps credential storage is not supported on ${platform}.`);
  }

  const macAccount = env.USER || env.LOGNAME || "";

  function requireMacAccount() {
    if (!macAccount) throw new Error("A local macOS account is required for FounderOps credential storage.");
    return macAccount;
  }

  function macSecurity(args, options) {
    return processResult(spawnSync, "/usr/bin/security", args, options);
  }

  function readMacToken() {
    const result = macSecurity([
      "find-generic-password", "-a", requireMacAccount(), "-s", MACOS_SERVICE, "-w",
    ], { stdio: ["ignore", "pipe", "pipe"] });
    if (result.status !== 0) {
      throw new Error("FounderOps token is missing from macOS Keychain.");
    }
    return validateFounderOpsToken(result.stdout);
  }

  function deleteMacToken({ missingIsError = true } = {}) {
    const result = macSecurity([
      "delete-generic-password", "-a", requireMacAccount(), "-s", MACOS_SERVICE,
    ], { stdio: ["ignore", "ignore", "ignore"] });
    if (result.status !== 0 && missingIsError) {
      throw new Error("FounderOps token is missing from macOS Keychain.");
    }
  }

  function storeMacToken(token) {
    const result = macSecurity([
      "add-generic-password", "-U", "-a", requireMacAccount(), "-s", MACOS_SERVICE,
      "-l", "FounderOps Team Task Intake Token", "-w",
    ], {
      input: `${token}\n${token}\n`,
      stdio: ["pipe", "ignore", "ignore"],
    });
    if (result.status !== 0) throw new Error("FounderOps token could not be stored in macOS Keychain.");
  }

  function windowsCredential(action, { interactive = false } = {}) {
    const args = [
      "-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass",
      ...(interactive ? [] : ["-NonInteractive"]),
      "-File", windowsScript, "-Action", action, "-Target", WINDOWS_TARGET,
    ];
    return processResult(spawnSync, "powershell.exe", args, {
      stdio: interactive ? "inherit" : ["ignore", "pipe", "pipe"],
    });
  }

  return {
    platform,

    readToken() {
      if (platform === "darwin") return readMacToken();
      const result = windowsCredential("read");
      if (result.status === 3) throw new Error("FounderOps token is missing from Windows Credential Manager.");
      if (result.status !== 0) throw new Error("FounderOps token could not be read from Windows Credential Manager.");
      return validateFounderOpsToken(result.stdout);
    },

    setInteractive() {
      if (platform === "darwin") {
        const result = macSecurity([
          "add-generic-password", "-U", "-a", requireMacAccount(), "-s", MACOS_SERVICE,
          "-l", "FounderOps Team Task Intake Token", "-w",
        ], { stdio: "inherit" });
        if (result.status !== 0) throw new Error("FounderOps token could not be stored in macOS Keychain.");
        try {
          readMacToken();
        } catch (error) {
          deleteMacToken({ missingIsError: false });
          throw error;
        }
        return;
      }
      const result = windowsCredential("set", { interactive: true });
      if (result.status !== 0) throw new Error("FounderOps token could not be stored in Windows Credential Manager.");
    },

    setClipboard() {
      if (platform === "darwin") {
        const clipboard = processResult(spawnSync, "/usr/bin/pbpaste", [], {
          stdio: ["ignore", "pipe", "pipe"],
        });
        if (clipboard.status !== 0) throw new Error("The macOS clipboard could not be read.");
        storeMacToken(validateFounderOpsToken(clipboard.stdout));
        return;
      }
      const result = windowsCredential("set-clipboard");
      if (result.status !== 0) throw new Error("FounderOps token could not be imported from the Windows clipboard.");
    },

    status() {
      if (platform === "darwin") {
        const result = macSecurity([
          "find-generic-password", "-a", requireMacAccount(), "-s", MACOS_SERVICE,
        ], { stdio: ["ignore", "ignore", "ignore"] });
        return result.status === 0;
      }
      const result = windowsCredential("status");
      if (result.status === 0) return true;
      if (result.status === 3) return false;
      throw new Error("FounderOps token status could not be read from Windows Credential Manager.");
    },

    deleteToken() {
      if (platform === "darwin") {
        deleteMacToken();
        return;
      }
      const result = windowsCredential("delete");
      if (result.status === 3) throw new Error("FounderOps token is missing from Windows Credential Manager.");
      if (result.status !== 0) throw new Error("FounderOps token could not be removed from Windows Credential Manager.");
    },
  };
}

