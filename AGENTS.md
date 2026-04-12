# AGENTS

This project has an agent-friendly test harness with two probe client modes: a fast lightweight mode and a rendered graphics mode. Use it instead of ad-hoc manual runs whenever you need to debug gameplay, verify a feature, or compare optimization changes.

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
- `bun run probe:agent --client-mode=rendered`
  Use when you need the real graphics client to boot with Pixi, ECS, camera, and render systems active.

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

Rendered probe mode:

```bash
bun run probe:agent --client-mode=rendered
```

Shortcut:

```bash
bun run probe:agent:rendered
```

Optional headed run:

```bash
bun run probe:agent --client-mode=rendered --headed
```

CLI flags are also supported:

```powershell
bun run probe:agent --duration=15000 --seed=42 --debug-performance
bun run probe:agent --artifacts-dir=.artifacts/perf-baseline --name="Feature Check"
bun run probe:agent --client-mode=rendered --capture-debug-trace --trace-interval=50
bun run probe:agent --client-mode=rendered --sim-latency=40
```

Useful environment overrides:

```powershell
$env:PROBE_DURATION_MS = "15000"; bun run probe:agent
$env:PROBE_SEED = "42"; $env:PROBE_ARTIFACTS_DIR = ".artifacts/perf-baseline"; bun run probe:agent
$env:PROBE_NAME = "Feature Check"; bun run probe:agent
$env:PROBE_DEBUG_PERFORMANCE = "1"; bun run probe:agent
$env:PROBE_CLIENT_MODE = "rendered"; bun run probe:agent
$env:PROBE_HEADED = "1"; $env:PROBE_CLIENT_MODE = "rendered"; bun run probe:agent
```

What the probe does:

- starts the Bun server in `--test-mode`
- enables deterministic server-side randomness when `--seed` is set
- when `--client-mode=lightweight` is used:
  - opens the game in `agent-mode` with audio disabled
  - uses a lightweight client path that does not depend on Pixi/WebGL boot completing
- when `--client-mode=rendered` is used:
  - builds the frontend bundle first and serves `dist/` from the same test server origin
  - opens the game in `agent-rendered` mode with audio disabled
  - boots the real graphics client with Pixi, ECS, camera, input, networking, and render systems active
  - uses a probe-compatible direct-stage renderer instead of the normal retro render-to-texture post-processing path, because that path is less stable under automated Playwright runs
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

## Probe Modes

- `lightweight`
  Best default for networking, spawning, connection flow, and fast reproducible metrics. It is faster and more robust than the rendered path, but it does not boot the visual Pixi gameplay pipeline.
- `rendered`
  Best for visual gameplay checks and debugging client rendering behavior. It boots a real graphics client, but it is intentionally not pixel-identical to the normal retro presentation path because the harness uses a more automation-stable renderer.

## Browser Test API

When the page is opened with `?agent-mode=true` or `?agent-rendered=true`, the client exposes:

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
- Escalate to `bun run probe:agent --client-mode=rendered` when the issue depends on graphics, camera, animation, or visual smoothing behavior.
- Prefer a fixed `--seed` when comparing behavior across runs.
- Prefer `?agent-mode=true&audio=off` for lightweight automation and `?agent-rendered=true&audio=off` for rendered automation.
- Prefer Playwright plus the test API for repeatable flows.
- Save evidence in `.artifacts/...` before making large refactors.

## When To Use What

- Use `bun dev` for quick local iteration.
- Use `bun run probe:agent` for debugging, performance sampling, and reproducible evidence gathering.
- Use `bun run test:e2e` before finishing changes that touch gameplay flow, networking, spawning, UI state, or reconnect behavior.

## Notes

- The server currently seeds process-wide `Math.random()` in test mode when `--seed` is provided. Keep the seed stable for apples-to-apples comparisons.
- Audio is intentionally disabled in both probe modes to avoid browser-automation instability.
- `rendered` probe mode automatically runs a frontend build before launching Playwright. You do not need to build manually before using `bun run probe:agent --client-mode=rendered`.
- The rendered harness uses a probe-compatible direct-stage graphics path. That makes it suitable for automation and visual debugging, but if you need to validate the exact production retro post-processing path, also sanity-check with a manual `bun dev` run.
- If a probe fails, check `summary.json` first; it is the fastest way to see whether the failure was in boot, connection, spawn, or runtime.
