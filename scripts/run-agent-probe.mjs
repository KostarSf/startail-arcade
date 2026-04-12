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

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      windowsHide: true,
      ...options,
    });

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`${command} exited with signal ${signal}`));
        return;
      }

      if (code !== 0) {
        reject(new Error(`${command} exited with code ${code ?? "unknown"}`));
        return;
      }

      resolve();
    });
  });
}

const options = parseCliOptions(process.argv.slice(2));
const env = { ...process.env };
const bunPath = process.env.BUN_PATH || "bun";
const clientMode = options["client-mode"] ?? env.PROBE_CLIENT_MODE ?? "lightweight";

applyEnvOverride(env, "PROBE_DURATION_MS", options.duration);
applyEnvOverride(env, "PROBE_SEED", options.seed);
applyEnvOverride(env, "PROBE_NAME", options.name);
applyEnvOverride(env, "PROBE_ARTIFACTS_DIR", options["artifacts-dir"]);
applyEnvOverride(env, "PROBE_PORT", options.port);
applyEnvOverride(env, "PROBE_CLIENT_MODE", options["client-mode"]);
applyEnvOverride(env, "PROBE_SIMULATED_LATENCY_MS", options["sim-latency"]);
applyEnvOverride(env, "PROBE_TRACE_INTERVAL_MS", options["trace-interval"]);

if (options["debug-performance"] === true) {
  env.PROBE_DEBUG_PERFORMANCE = "1";
}

if (options["disable-reconciliation"] === true) {
  env.PROBE_DISABLE_RECONCILIATION = "1";
}

if (options["disable-interpolation"] === true) {
  env.PROBE_DISABLE_INTERPOLATION = "1";
}

if (options["capture-debug-trace"] === true) {
  env.PROBE_CAPTURE_DEBUG_TRACE = "1";
}

if (options.headed === true) {
  env.PROBE_HEADED = "1";
}

if (clientMode === "rendered") {
  env.STARTAIL_STATIC_DIST_DIR = path.resolve(process.cwd(), "dist");
}

const playwrightCli = path.resolve(
  process.cwd(),
  "node_modules",
  "@playwright",
  "test",
  "cli.js"
);

async function main() {
  if (clientMode === "rendered") {
    console.log("[probe] building bundled frontend for rendered probe");
    await runCommand(bunPath, ["run", "build.ts"], {
      cwd: process.cwd(),
      env,
    });
  }

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
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
