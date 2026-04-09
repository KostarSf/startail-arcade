#!/usr/bin/env node

import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";

function parseCliOptions(argv) {
  const options = {};

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (!arg?.startsWith("--")) continue;

    if (arg.includes("=")) {
      const [key, value] = arg.slice(2).split("=", 2);
      if (!key) continue;
      options[key] = value ?? true;
      continue;
    }

    const key = arg.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      options[key] = next;
      index++;
      continue;
    }

    options[key] = true;
  }

  return options;
}

function applyEnvOverride(env, key, value) {
  if (typeof value === "string" && value.length > 0) {
    env[key] = value;
  }
}

const options = parseCliOptions(process.argv.slice(2));
const env = { ...process.env };

applyEnvOverride(env, "PROBE_DURATION_MS", options.duration);
applyEnvOverride(env, "PROBE_SEED", options.seed);
applyEnvOverride(env, "PROBE_NAME", options.name);
applyEnvOverride(env, "PROBE_ARTIFACTS_DIR", options["artifacts-dir"]);
applyEnvOverride(env, "PROBE_PORT", options.port);

if (options["debug-performance"] === true) {
  env.PROBE_DEBUG_PERFORMANCE = "1";
}

const playwrightCli = path.resolve(
  process.cwd(),
  "node_modules",
  "@playwright",
  "test",
  "cli.js"
);

const child = spawn(
  process.execPath,
  [playwrightCli, "test", "--config=playwright.probe.config.ts"],
  {
    stdio: "inherit",
    windowsHide: true,
    env,
  }
);

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});
