# AGENTS

This project has a lightweight agent-friendly test harness. Use it instead of ad-hoc manual runs whenever you need to debug gameplay, verify a feature, or compare optimization changes.

## Setup

- Install dependencies with `bun install`.
- Install the headless browser once with `bun run test:install-browsers`.
- Keep probe artifacts under `.artifacts/`; that directory is ignored by git.

## Test Modes

- `bun test`
  Use for fast logic/unit coverage in `tests/unit`.
- `bun run test:e2e`
  Use for browser-level regression checks with Playwright.
- `bun run probe:agent`
  Use for short autonomous diagnostic runs that start the server, join the game, capture client/server metrics and logs, take a screenshot, and exit cleanly.

## Recommended Workflow

For a bug fix:

1. Reproduce with `bun run probe:agent`.
2. Inspect `.artifacts/agent-probe/summary.json`, `metrics.json`, `client.log`, and `server.log`.
3. Make the change.
4. Re-run `bun run probe:agent`.
5. Run `bun run test:e2e` for browser regression coverage.

For a new gameplay or UI feature:

1. Run the app manually with `bun dev` while iterating.
2. Validate the final behavior with `bun run probe:agent`.
3. If the change affects spawning, networking, or game flow, also run `bun run test:e2e`.

For optimization work:

1. Run `bun run probe:agent --debug-performance --duration=15000 --seed=42`.
2. Compare `metrics.json` and `server.log` before and after the change.
3. Keep the same `--seed` and duration when comparing runs.

## Probe Command

Default command:

```bash
bun run probe:agent
```

CLI flags are also supported:

```powershell
bun run probe:agent --duration=15000 --seed=42 --debug-performance
bun run probe:agent --artifacts-dir=.artifacts/perf-baseline --name="Feature Check"
```

Useful environment overrides:

```powershell
$env:PROBE_DURATION_MS = "15000"; bun run probe:agent
$env:PROBE_SEED = "42"; $env:PROBE_ARTIFACTS_DIR = ".artifacts/perf-baseline"; bun run probe:agent
$env:PROBE_NAME = "Feature Check"; bun run probe:agent
$env:PROBE_DEBUG_PERFORMANCE = "1"; bun run probe:agent
```

What the probe does:

- starts the Bun server in `--test-mode`
- enables deterministic server-side randomness when `--seed` is set
- opens the game in `agent-mode` with audio disabled
- uses a lightweight headless client path that does not depend on Pixi/WebGL boot completing
- waits for the browser test API to become available
- joins the game
- briefly exercises movement/fire input
- captures:
  - `summary.json`
  - `metrics.json`
  - `client.log`
  - `server.log`
  - `server.stderr.log`
  - `screenshot.png`

## Browser Test API

When the page is opened with `?agent-mode=true`, the client exposes:

```ts
window.__STARTAIL_TEST_API__
```

Available helpers:

- `ping()`
- `respawn(name)`
- `sendInput({ thrust, angle, fire, firingCompensation })`
- `configureDebug({ drawGrid, drawWorldBorder, drawColliders, simulatedLatencyMs })`
- `getSnapshot()`

Use these helpers from Playwright `page.evaluate(...)` instead of poking random DOM nodes when you need reliable automation.

## Server Test Endpoints

When the server is started with `--test-mode`, these endpoints are available:

- `/__test/health`
- `/__test/metrics`
- `/__test/snapshot`

Use them to fetch authoritative server-side state after a run. This is especially useful for networking issues, entity-count explosions, and optimization checks.

## Good Defaults For Agents

- Prefer `bun run probe:agent` over manual browser poking when you need logs and metrics.
- Prefer a fixed `--seed` when comparing behavior across runs.
- Prefer `?agent-mode=true&audio=off` for any automated browser session.
- Prefer Playwright plus the test API for repeatable flows.
- Save evidence in `.artifacts/...` before making large refactors.

## When To Use What

- Use `bun dev` for quick local iteration.
- Use `bun run probe:agent` for debugging, performance sampling, and reproducible evidence gathering.
- Use `bun run test:e2e` before finishing changes that touch gameplay flow, networking, spawning, UI state, or reconnect behavior.

## Notes

- The server currently seeds process-wide `Math.random()` in test mode when `--seed` is provided. Keep the seed stable for apples-to-apples comparisons.
- Audio is intentionally disabled in agent mode to avoid headless-browser instability.
- If a probe fails, check `summary.json` first; it is the fastest way to see whether the failure was in boot, connection, spawn, or runtime.
