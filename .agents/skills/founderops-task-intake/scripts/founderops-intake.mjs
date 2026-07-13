#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createCredentialStore } from "./credential-store.mjs";
import { validateInitiativeContextResponse } from "./initiative-context.mjs";

const DEFAULT_BASE_URL = "https://founder-ops.findmydoc.eu";
const SUPPORTED_COMMANDS = new Set(["context", "preview", "commit"]);

function usage() {
  console.error(`Usage:
  founderops-intake.mjs context [--base-url <url>]
  founderops-intake.mjs preview --file <path|-> [--base-url <url>]
  founderops-intake.mjs commit --confirm --file <path|-> [--idempotency-key <uuid>] [--base-url <url>]`);
}

function parseArguments(argv) {
  const options = { command: argv[0] || "", file: "", baseUrl: process.env.FOUNDEROPS_BASE_URL || DEFAULT_BASE_URL, idempotencyKey: "", confirm: false };
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--confirm") {
      options.confirm = true;
      continue;
    }
    if (["--file", "--base-url", "--idempotency-key"].includes(argument)) {
      const value = argv[index + 1];
      if (!value) throw new Error(`${argument} requires a value.`);
      if (argument === "--file") options.file = value;
      if (argument === "--base-url") options.baseUrl = value;
      if (argument === "--idempotency-key") options.idempotencyKey = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  options.baseUrl = options.baseUrl.replace(/\/+$/, "");
  return options;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function readPayload(file) {
  if (!file) throw new Error("preview and commit require --file <path|->.");
  const raw = file === "-" ? await readStdin() : await readFile(file, "utf8");
  const payload = JSON.parse(raw);
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || !Array.isArray(payload.items)) {
    throw new Error('Payload must be an object with an "items" array.');
  }
  return JSON.stringify(payload);
}

async function requestJson(url, init) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) });
  const raw = await response.text();
  let body;
  try {
    body = raw ? JSON.parse(raw) : null;
  } catch {
    body = raw;
  }
  if (!response.ok) {
    const detail = typeof body === "object" && body && "error" in body ? body.error : body;
    throw new Error(`FounderOps API returned ${response.status}${detail ? `: ${String(detail)}` : ""}`);
  }
  return body;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (!SUPPORTED_COMMANDS.has(options.command)) {
    usage();
    process.exitCode = 2;
    return;
  }
  if (options.command === "commit" && !options.confirm) {
    throw new Error("commit requires --confirm after the preview has been approved.");
  }

  const token = createCredentialStore().readToken();
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    "User-Agent": "founderops-task-intake-skill/1.0",
  };

  let endpoint = "/api/team/task-context";
  let method = "GET";
  let body;
  if (options.command !== "context") {
    endpoint = `/api/team/task-intake/v2/${options.command}`;
    method = "POST";
    body = await readPayload(options.file);
    headers["Content-Type"] = "application/json";
  }
  if (options.command === "commit") {
    const idempotencyKey = options.idempotencyKey || randomUUID();
    headers["Idempotency-Key"] = idempotencyKey;
    console.error(`Idempotency-Key: ${idempotencyKey}`);
  }

  const result = await requestJson(`${options.baseUrl}${endpoint}`, { method, headers, body });
  if (options.command === "context") validateInitiativeContextResponse(result);
  if (options.command === "commit" && result && Array.isArray(result.items)) {
    result.itemLinks = result.items.map((entry) => {
      const item = entry.item || {};
      return {
        id: item.id || "",
        title: item.title || "",
        itemType: entry.itemType,
        url: entry.itemType === "initiative"
          ? `${options.baseUrl}/?workspace=projects`
          : `${options.baseUrl}/tasks/${encodeURIComponent(item.id || "")}`,
      };
    });
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

