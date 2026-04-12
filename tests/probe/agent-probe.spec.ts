import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";

import { test } from "@playwright/test";

function parseEnvNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseEnvBoolean(name: string): boolean {
  const raw = process.env[name];
  if (!raw) return false;
  return raw === "1" || raw.toLowerCase() === "true";
}

async function getFreePort() {
  return await new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Failed to resolve a free TCP port"));
        return;
      }

      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(address.port);
      });
    });
  });
}

async function waitForHealth(baseUrl: string, timeoutMs: number) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${baseUrl}/__test/health`);
      if (response.ok) {
        return await response.json();
      }
    } catch {
      // Keep polling until timeout.
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`Timed out waiting for ${baseUrl}/__test/health`);
}

async function terminateProcess(child: ChildProcess) {
  if (child.killed) {
    return;
  }

  if (process.platform === "win32") {
    await new Promise<void>((resolve) => {
      const killer = spawn(
        "taskkill",
        ["/pid", String(child.pid), "/t", "/f"],
        {
          stdio: "ignore",
          windowsHide: true,
        }
      );
      killer.once("exit", () => resolve());
      killer.once("error", () => resolve());
    });
    return;
  }

  child.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 3_000);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

async function waitForClientCondition(
  page: import("@playwright/test").Page,
  condition: () => unknown,
  options: {
    timeoutMs: number;
    description: string;
    getPageErrors: () => string[];
  }
) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < options.timeoutMs) {
    const pageErrors = options.getPageErrors();
    if (pageErrors.length > 0) {
      throw new Error(
        `Client boot failed while waiting for ${options.description}: ${pageErrors[0]}`
      );
    }

    const satisfied = await page.evaluate(condition);
    if (satisfied) {
      return;
    }

    await page.waitForTimeout(250);
  }

  const pageErrors = options.getPageErrors();
  if (pageErrors.length > 0) {
    throw new Error(
      `Client boot failed while waiting for ${options.description}: ${pageErrors[0]}`
    );
  }

  throw new Error(`Timed out waiting for ${options.description}`);
}

test("agent probe captures client and server artifacts", async ({ browser }) => {
  const cwd = process.cwd();
  const artifactsDir = path.resolve(
    cwd,
    process.env.PROBE_ARTIFACTS_DIR || ".artifacts/agent-probe"
  );
  const durationMs = parseEnvNumber("PROBE_DURATION_MS", 12_000);
  const seed = parseEnvNumber("PROBE_SEED", 42);
  const port = parseEnvNumber("PROBE_PORT", await getFreePort());
  const probeName = process.env.PROBE_NAME || "Agent Probe";
  const clientMode = process.env.PROBE_CLIENT_MODE || "lightweight";
  const debugPerformance = process.env.PROBE_DEBUG_PERFORMANCE === "1";
  const simulatedLatencyMs = parseEnvNumber("PROBE_SIMULATED_LATENCY_MS", 0);
  const disableInterpolation = parseEnvBoolean("PROBE_DISABLE_INTERPOLATION");
  const disableReconciliation = parseEnvBoolean(
    "PROBE_DISABLE_RECONCILIATION"
  );
  const captureDebugTrace = parseEnvBoolean("PROBE_CAPTURE_DEBUG_TRACE");
  const traceIntervalMs = parseEnvNumber("PROBE_TRACE_INTERVAL_MS", 50);
  const baseUrl = `http://127.0.0.1:${port}`;

  await mkdir(artifactsDir, { recursive: true });

  let serverStdout = "";
  let serverStderr = "";
  const clientLogs: string[] = [];
  const pageErrors: string[] = [];
  const summary: Record<string, unknown> = {
    ok: false,
    baseUrl,
    seed,
    durationMs,
    clientMode,
    simulatedLatencyMs,
    disableInterpolation,
    disableReconciliation,
    captureDebugTrace,
    startedAt: new Date().toISOString(),
  };
  const debugTrace: Array<Record<string, unknown>> = [];

  const serverProcess = spawn(
    process.env.BUN_PATH || "bun",
    [
      "src/index.ts",
      "--test-mode",
      `--port=${port}`,
      `--seed=${seed}`,
      ...(debugPerformance ? ["--debug-performance"] : []),
    ],
    {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      env: {
        ...process.env,
        ...(clientMode === "rendered" && process.env.STARTAIL_STATIC_DIST_DIR
          ? { STARTAIL_STATIC_DIST_DIR: process.env.STARTAIL_STATIC_DIST_DIR }
          : {}),
      },
    }
  );

  serverProcess.stdout.on("data", (chunk) => {
    serverStdout += chunk.toString();
  });
  serverProcess.stderr.on("data", (chunk) => {
    serverStderr += chunk.toString();
  });

  const page = await browser.newPage({
    viewport: { width: 1600, height: 900 },
  });

  page.on("console", (message) => {
    clientLogs.push(`[${message.type()}] ${message.text()}`);
  });
  page.on("pageerror", (error) => {
    const message = error.stack ?? error.message;
    pageErrors.push(message);
    clientLogs.push(`[pageerror] ${message}`);
  });

  try {
    await waitForHealth(baseUrl, 60_000);

    const searchParams = new URLSearchParams();
    searchParams.set("audio", "off");
    if (clientMode === "rendered") {
      searchParams.set("agent-rendered", "true");
    } else {
      searchParams.set("agent-mode", "true");
    }

    await page.goto(`${baseUrl}/?${searchParams.toString()}`);

    await waitForClientCondition(page, () => {
      return window.__STARTAIL_TEST_API__?.ping() === "pong";
    }, {
      timeoutMs: 20_000,
      description: "test API to become available",
      getPageErrors: () => pageErrors,
    });

    if (clientMode === "rendered") {
      await waitForClientCondition(page, () => {
        const snapshot = window.__STARTAIL_TEST_API__?.getSnapshot();
        return Boolean(
          snapshot?.boot.appInitialized &&
            snapshot.boot.servicesReady &&
            snapshot.boot.pipelineReady
        );
      }, {
        timeoutMs: 20_000,
        description: "rendered client pipeline to finish booting",
        getPageErrors: () => pageErrors,
      });
    }

    await page.evaluate(
      ({ simulatedLatencyMs, disableInterpolation, disableReconciliation }) => {
      window.__STARTAIL_TEST_API__?.configureDebug({
        simulatedLatencyMs,
        disableInterpolation,
        disableReconciliation,
      });
      },
      { simulatedLatencyMs, disableInterpolation, disableReconciliation }
    );

    await waitForClientCondition(page, () => {
      const snapshot = window.__STARTAIL_TEST_API__?.getSnapshot();
      return Boolean(snapshot?.connected);
    }, {
      timeoutMs: 20_000,
      description: "websocket connection",
      getPageErrors: () => pageErrors,
    });

    await page.evaluate((name) => {
      window.__STARTAIL_TEST_API__?.respawn(name);
    }, probeName);

    await waitForClientCondition(page, () => {
      const snapshot = window.__STARTAIL_TEST_API__?.getSnapshot();
      return Boolean(
        snapshot?.connected &&
          snapshot.player.alive &&
          snapshot.stats.hasTimeSync
      );
    }, {
      timeoutMs: 20_000,
      description: "spawned player with time sync",
      getPageErrors: () => pageErrors,
    });

    await page.evaluate(() => {
      window.__STARTAIL_TEST_API__?.sendInput({
        thrust: true,
        angle: 0,
        fire: false,
      });
    });

    const traceStartedAt = Date.now();
    let fireSent = false;
    let stopSent = false;

    while (Date.now() - traceStartedAt < durationMs) {
      const elapsedMs = Date.now() - traceStartedAt;

      if (!fireSent && elapsedMs >= 1_000) {
        fireSent = true;
        await page.evaluate(() => {
          window.__STARTAIL_TEST_API__?.sendInput({
            thrust: true,
            angle: 0,
            fire: true,
            firingCompensation: true,
          });
        });
      }

      if (!stopSent && elapsedMs >= 1_250) {
        stopSent = true;
        await page.evaluate(() => {
          window.__STARTAIL_TEST_API__?.sendInput({
            thrust: false,
            angle: 0,
            fire: false,
          });
        });
      }

      if (captureDebugTrace) {
        const traceSample = await page.evaluate(() => ({
          runtime: window.__STARTAIL_TEST_API__?.getSnapshot() ?? null,
          debug:
            window.__STARTAIL_TEST_API__?.getDebugNetworkSnapshot() ?? null,
        }));
        debugTrace.push({
          elapsedMs,
          ...traceSample,
        });
      }

      await page.waitForTimeout(traceIntervalMs);
    }

    const clientSnapshot = await page.evaluate(() => {
      return window.__STARTAIL_TEST_API__?.getSnapshot() ?? null;
    });

    const serverMetrics = await fetch(`${baseUrl}/__test/metrics`).then((response) =>
      response.json()
    );
    const serverSnapshot = await fetch(`${baseUrl}/__test/snapshot`).then((response) =>
      response.json()
    );

    await page.screenshot({
      path: path.join(artifactsDir, "screenshot.png"),
      fullPage: true,
    });

    Object.assign(summary, {
      ok: true,
      finishedAt: new Date().toISOString(),
      clientSnapshot,
      serverMetrics,
      serverSnapshot,
      pageErrors,
      debugTraceSamples: debugTrace.length,
    });

    await writeFile(
      path.join(artifactsDir, "metrics.json"),
      JSON.stringify(
        {
          clientSnapshot,
          serverMetrics,
          serverSnapshot,
        },
        null,
        2
      )
    );

    if (captureDebugTrace) {
      await writeFile(
        path.join(artifactsDir, "debug-trace.json"),
        JSON.stringify(debugTrace, null, 2)
      );
    }
  } catch (error) {
    Object.assign(summary, {
      ok: false,
      finishedAt: new Date().toISOString(),
      pageErrors,
      error: error instanceof Error ? error.stack ?? error.message : String(error),
    });
    throw error;
  } finally {
    await page.close();
    await terminateProcess(serverProcess);

    await Promise.all([
      writeFile(path.join(artifactsDir, "server.log"), serverStdout),
      writeFile(path.join(artifactsDir, "server.stderr.log"), serverStderr),
      writeFile(path.join(artifactsDir, "client.log"), clientLogs.join("\n")),
      writeFile(
        path.join(artifactsDir, "summary.json"),
        JSON.stringify(summary, null, 2)
      ),
    ]);
  }
});
