import assert from "node:assert/strict";
import test from "node:test";
import { createCredentialStore, validateFounderOpsToken } from "../scripts/credential-store.mjs";

const token = "fmd_ti_test-secret-value";

function fakeProcess(responses) {
  const calls = [];
  const spawnSync = (command, args, options) => {
    calls.push({ command, args, options });
    return responses.shift() || { status: 0, stdout: "", stderr: "" };
  };
  return { calls, spawnSync };
}

test("validates the FounderOps token prefix", () => {
  assert.equal(validateFounderOpsToken(` ${token}\n`), token);
  assert.throws(() => validateFounderOpsToken("wrong-token"), /not a FounderOps/);
});

test("reads macOS credentials without putting the token in command arguments", () => {
  const process = fakeProcess([{ status: 0, stdout: `${token}\n`, stderr: "" }]);
  const store = createCredentialStore({ platform: "darwin", env: { USER: "tester" }, spawnSync: process.spawnSync });

  assert.equal(store.readToken(), token);
  assert.equal(process.calls.length, 1);
  assert.equal(process.calls[0].command, "/usr/bin/security");
  assert.doesNotMatch(process.calls[0].args.join(" "), /test-secret-value/);
});

test("imports the macOS clipboard without putting the token in command arguments or output", () => {
  const process = fakeProcess([
    { status: 0, stdout: token, stderr: "" },
    { status: 0, stdout: "", stderr: "" },
  ]);
  const store = createCredentialStore({ platform: "darwin", env: { USER: "tester" }, spawnSync: process.spawnSync });

  store.setClipboard();
  assert.equal(process.calls.length, 2);
  assert.equal(process.calls[0].command, "/usr/bin/pbpaste");
  assert.equal(process.calls[1].command, "/usr/bin/security");
  assert.doesNotMatch(process.calls[1].args.join(" "), /test-secret-value/);
  assert.match(process.calls[1].options.input, /^fmd_ti_/);
  assert.equal(process.calls[1].options.stdio[1], "ignore");
});

test("uses one Windows Credential Manager process per operation", () => {
  const process = fakeProcess([
    { status: 0, stdout: token, stderr: "" },
    { status: 0, stdout: "", stderr: "" },
  ]);
  const store = createCredentialStore({
    platform: "win32",
    spawnSync: process.spawnSync,
    windowsScript: "C:\\skill\\windows-credential-manager.ps1",
  });

  assert.equal(store.readToken(), token);
  store.setClipboard();
  assert.equal(process.calls.length, 2);
  for (const call of process.calls) {
    assert.equal(call.command, "powershell.exe");
    assert.doesNotMatch(call.args.join(" "), /test-secret-value/);
  }
  assert.match(process.calls[0].args.join(" "), /-Action read/);
  assert.match(process.calls[1].args.join(" "), /-Action set-clipboard/);
});

test("redacts child-process output from credential errors", () => {
  const process = fakeProcess([{ status: 1, stdout: token, stderr: token }]);
  const store = createCredentialStore({ platform: "win32", spawnSync: process.spawnSync });

  assert.throws(
    () => store.readToken(),
    (error) => error instanceof Error && !error.message.includes(token) && /could not be read/.test(error.message),
  );
});

test("distinguishes configured and missing credentials", () => {
  const configured = fakeProcess([{ status: 0, stdout: "", stderr: "" }]);
  const missing = fakeProcess([{ status: 3, stdout: "", stderr: "" }]);

  assert.equal(createCredentialStore({ platform: "win32", spawnSync: configured.spawnSync }).status(), true);
  assert.equal(createCredentialStore({ platform: "win32", spawnSync: missing.spawnSync }).status(), false);
});

test("does not hide Windows Credential Manager status errors as missing credentials", () => {
  const failed = fakeProcess([{ status: 1, stdout: token, stderr: token }]);
  const store = createCredentialStore({ platform: "win32", spawnSync: failed.spawnSync });

  assert.throws(
    () => store.status(),
    (error) => error instanceof Error && !error.message.includes(token) && /status could not be read/.test(error.message),
  );
});

test("fails closed on unsupported operating systems", () => {
  assert.throws(() => createCredentialStore({ platform: "linux" }), /not supported on linux/);
});

