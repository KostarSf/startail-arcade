# Network Presentation Refactor Plan

## Purpose

This document captures the agreed technical plan for the next network and
presentation refactor.

The goal is to make the multiplayer presentation layer stable and predictable
under:

- normal play
- moderate latency and jitter
- temporary server-side under-run
- temporary client-side receive backlog
- future scheduler and gameplay optimizations

This plan intentionally avoids temporary fixes. It describes the target
architecture we want to move the project toward.

## Why This Refactor Is Needed

The main reconciliation regression was already fixed by moving local-player
reconciliation to simulation ticks. However, two related classes of problems
remain:

1. Interpolation no longer has enough safety margin under the new snapshot
   scheduler.
2. The world still visibly stalls or jerks at regular intervals, especially
   when interpolation and reconciliation are disabled.

Current evidence suggests the remaining issues are architectural, not cosmetic:

- the server snapshot scheduler currently works off wall-clock timer slots
  rather than a deterministic per-commit stream
- commits may effectively disappear from the outbound stream when the scheduler
  misses phase
- the client interpolation layer still relies on a fixed render delay and a
  simplistic starvation model
- the client does not yet have an explicit degraded presentation mode when the
  authoritative stream ages badly

As a result:

- remote world presentation can collapse from interpolation into sample-and-hold
- the local ship can inherit visible hitching from stale authoritative frames
- the system becomes sensitive to scheduler jitter and future performance work

## Problems This Refactor Must Solve

### 1. Predictable Outbound Snapshot Cadence

The server must not skip authoritative progression simply because a timer fired
at an awkward moment. Snapshot delivery should be coupled to committed
simulation progression, not only to wall-clock slots.

### 2. Stable Presentation Under Variable Authoritative Cadence

The client should keep the world smooth under normal jitter, become more
conservative under stress, and degrade into a controlled slowdown or hold under
severe starvation instead of producing abrupt jerks.

### 3. Correct Behavior When Server TPS Falls Below Nominal

If the server is producing commits more slowly than nominal TPS, the client
must adapt its presentation to the real authoritative cadence instead of
pretending that the world is still advancing at the old wall-clock tempo.

### 4. Compatibility With Future Optimizations

The resulting model should remain valid after:

- scheduler refinements
- snapshot build optimization
- active-world / sleeping-sector work
- deeper simulation optimization

The presentation layer should not depend on fragile timing coincidences.

## Agreed Architecture

### Core Separation

The system should explicitly separate three kinds of truth:

- simulation truth: authoritative simulation ticks
- transport truth: actual committed snapshot cadence and packet arrival timing
- presentation truth: client-side adaptive rendering buffer and local
  prediction policy

### High-Level Contract

- server snapshot stream semantics: `per-commit`
- backlog policy: `bounded catch-up`
- reconciliation model: tick-based
- client presentation model: `hybrid`

That means:

- every committed simulation tick should belong to the authoritative stream in
  order
- the scheduler must not silently throw away commits due to timer phase
- reconciliation remains based on simulation ticks
- interpolation and render buffering adapt to real authoritative cadence

## Agreed Server Behavior

### Snapshot Stream Semantics

Use `per-commit`, not `latest-on-slot`.

Meaning:

- each committed simulation tick may be sent at most once
- commits stay ordered
- scheduler logic is not allowed to erase intermediate commits just because a
  wall-clock slot was skipped or arrived early

### Backlog Policy

Use `bounded catch-up`.

Meaning:

- the server may accumulate a limited backlog of unsent committed frames
- it should send backlog in order while within policy limits
- if backlog exceeds the configured bound, the server enters explicit degraded
  mode instead of silently collapsing temporal structure

### When Server TPS Falls Below Nominal

The server continues to own simulation truth through ticks, but the rest of the
stack must accept that the effective authoritative cadence is slower.

This does not mean the client should reinterpret simulation rules.

It does mean:

- snapshot cadence can legitimately slow down when committed ticks arrive more
  slowly
- the server should expose degraded stream state explicitly
- the client presentation layer must adapt to the observed authoritative rate

### Degradation Order

When backlog pressure rises, degrade in this order:

1. Optional streams first
2. Snapshot build cost second
3. Deeper degradation only as an explicit last resort

#### Optional Streams First

Allowed first-stage degradation:

- reduce or disable radar updates
- relax keyframe cadence within bounded rules
- reduce diagnostics or optional metadata that is not required for gameplay

#### Snapshot Build Cost Second

Allowed second-stage degradation:

- simplify or optimize partial payload generation
- reduce repeated visibility work
- remove non-essential replicated fields from ordinary entity updates where safe

Core authoritative entity progression and commit ordering must remain intact.

### Full Snapshots

Use `bounded adaptive keyframes`.

Meaning:

- full snapshots remain a required recovery mechanism
- they keep a stable baseline cadence in normal operation
- under degraded conditions their interval may stretch, but only within a hard
  bound

This preserves recovery guarantees without wasting bandwidth or build time in
the worst moments.

### Minimal Metadata Block

Server snapshots should gain a compact stream policy metadata block.

Initial intent:

- `streamHealth`: `normal | stressed | degraded`
- `degradedFeatures`: compact flags such as:
  - radar reduced
  - keyframes relaxed

Possible future extension if needed:

- cadence hint / effective commit rate hint

This metadata should remain minimal. It exists to communicate policy and help
diagnostics, not to replace client-side measurement.

## Agreed Client Behavior

### Overall Model

Use `hybrid`.

Meaning:

- reconciliation continues to follow nominal simulation ticks
- interpolation and render delay adapt to effective authoritative cadence

This keeps local-player prediction architecturally clean while letting visual
presentation respond to real stream conditions.

### Stream Health Ownership

Use `server-escalation allowed`.

Meaning:

- the client computes stream health primarily from local observations
- the server may escalate the client into a more conservative mode earlier
- the server may not force the client into a more optimistic mode than local
  observations allow

In practice:

- client decides when things are healthy enough to recover
- server can warn early when it is already in degraded replication mode

### Adaptive Presentation Controller

Use `hybrid`, not `delay-only`.

Meaning:

- the client adjusts render delay continuously
- the client also maintains a small global health state such as:
  - `normal`
  - `stressed`
  - `degraded`
- per-type interpolation tail and correction policies may become more
  conservative under worse stream health

### Reconciliation

Reconciliation remains tick-based and uses `soft guard`.

#### Guard Model

Use `combined`.

Primary limiter:

- bounded replay horizon by time and corresponding tick count beyond the last
  authoritative snapshot

Secondary safety:

- divergence threshold as an additional emergency guard

This prevents local prediction from running too far ahead when the
authoritative stream becomes stale.

### Interpolation Under Starvation

For remote entities, use a `short bounded tail`.

Meaning:

- when the interpolation window temporarily loses a `next snapshot`, remote
  entities may continue a short distance using recent velocity
- this tail must stay small and bounded
- after the bounded tail is exhausted, the entity should hold rather than keep
  extrapolating indefinitely

### Return From Extrapolation

Use `visual offset decay` for re-entry correction.

Meaning:

- extrapolated pose is never treated as new authoritative truth
- when a new authoritative frame arrives, authoritative state becomes the new
  basis immediately
- visually, the object is corrected back through a short presentation-level
  offset decay

Do not rebuild the snapshot buffer around extrapolated state.

Snap directly instead of smoothing when:

- teleport
- wrap
- respawn
- destroy
- remove
- large discontinuity beyond smoothing thresholds

### Type-Specific Tail Rules

Tail policy should be type-specific.

Initial target:

- remote ships:
  - short bounded tail
  - visual offset decay on re-entry
- asteroids:
  - short bounded tail
  - may tolerate slightly wider tail than ships
- bullets:
  - no tail or extremely tiny tail only
- exp:
  - no tail or extremely tiny tail only
- warp / respawn / destroy / remove:
  - snap only

This prevents high-error types from introducing more visual lies than benefit.

## Expected Visual Behavior

### Short Server Stall

Example: the server stops delivering frames for about one second due to load.

Desired experience:

- the remote world remains smooth for as long as buffered data allows
- then transitions into controlled slowdown or hold
- the local ship remains responsive only within bounded replay horizon
- once frames resume, the world returns through buffer recovery rather than
  snapping violently

This should look more like:

- smooth
- then brief slowdown/freeze
- then smooth recovery

and less like:

- jump
- correction
- jump

### Growing Client-Side Receive Delay

Example: the player's channel degrades and packets keep arriving later and
later.

Desired experience:

- the world stays smoother for longer by increasing presentation delay
- remote entities become visually more delayed but less jerky
- the local ship gradually feels heavier or more rubbery, not violently
  hitchy
- soft guard prevents prediction from racing too far ahead

This should degrade into:

- increasing delay
- heavier response
- coherent but degraded presentation

rather than chaotic jitter.

## Harness Refactor

### Goal

The probe harness should support:

- cheap lightweight network/boot diagnostics
- a rendered full-client probe path that behaves as close as possible to the
  real game

### Agreed Direction

Keep two modes:

- `lightweight`
- `rendered`

The `rendered` probe should:

- build the frontend first
- serve the bundled `dist` assets from the same game server origin
- run Playwright against the built client instead of Bun dev-bundle output

### Why

This keeps:

- `/ws`
- `/check-support`
- test endpoints
- static assets

on a single origin and avoids probe-only client boot differences.

### Current Status

The build-then-probe path has been automated, but rendered full-client boot is
still blocked by a full-client initialization error in the rendered pipeline.

That blocker should be fixed before using rendered probes as the main
regression signal for this refactor.

## Refactor Scope

### Server-Side Likely Touch Points

- `src/server/engine/server-network.ts`
- `src/server/engine/engine.ts`
- `src/server/bootstrap.ts`
- shared network event typings for metadata additions

Potentially also:

- snapshot build helpers
- scheduler statistics
- replication diagnostics

### Client-Side Likely Touch Points

- `src/client/game/network/snapshot-buffer.ts`
- `src/client/game/systems/interpolation-system.ts`
- `src/client/game/systems/reconciliation-system.ts`
- `src/client/game/network/reconcile-ship-state.ts`
- `src/client/game/client-engine.ts`
- shared network event typings for metadata additions

Potentially also:

- per-type entity presentation handling
- debug telemetry / test API

### Harness Likely Touch Points

- `scripts/run-agent-probe.mjs`
- `tests/probe/agent-probe.spec.ts`
- `playwright.probe.config.ts`
- `AGENTS.md`

## Proposed Implementation Order

### Phase 0: Stabilize Rendered Probe

Before changing network presentation behavior:

1. Finish the rendered probe boot path
2. Ensure build-then-probe runs consistently
3. Make rendered probe failures fast and explicit
4. Preserve lightweight probe for quick diagnostics

### Phase 1: Server Snapshot Stream Refactor

1. Replace the current timer-driven effective `latest-on-slot` behavior with
   `per-commit`
2. Introduce explicit per-player backlog tracking
3. Implement `bounded catch-up`
4. Add degraded mode transitions and scheduler metrics
5. Add minimal metadata block to snapshot payload

Deliverable:

- deterministic ordered commit stream
- explicit backlog and degraded mode behavior

### Phase 2: Client Adaptive Presentation Layer

1. Add stream health model on the client
2. Compute local stream health from:
   - frame age
   - starvation duration
   - arrival jitter
   - missing future snapshots
3. Accept optional server escalation hints
4. Replace fixed render delay with adaptive render delay

Deliverable:

- presentation buffer that responds to real authoritative cadence

### Phase 3: Remote Entity Starvation Handling

1. Add type-specific short bounded tail
2. Add presentation-only visual offset decay on re-entry
3. Add snap rules for teleports / wrap / respawn / destroy / large divergence
4. Keep snapshot buffer authoritative and clean

Deliverable:

- smoother short starvation behavior without long extrapolation lies

### Phase 4: Reconciliation Soft Guard

1. Add bounded replay horizon based on time/ticks
2. Add divergence safety threshold
3. Ensure local-player feel degrades conservatively rather than hitching

Deliverable:

- local ship stays stable when authoritative frames grow stale

### Phase 5: Policy-Driven Degradation

1. Hook server degraded modes into optional stream reduction
2. Allow bounded adaptive keyframes
3. Add debug/probe observability for:
   - stream health
   - backlog depth
   - effective commit cadence
   - starvation time
   - active degraded features

Deliverable:

- an observable, policy-driven degraded mode instead of accidental behavior

## Testing Strategy

### Probe Coverage

Use both probe modes:

- lightweight probe for fast cadence and metadata diagnostics
- rendered probe for real visual/presentation regressions

Required scenarios:

- baseline normal load
- simulated latency around expected production values
- induced starvation or artificial receive delay
- server under-run scenario

### What To Measure

Server-side:

- committed tick cadence
- sent frame cadence
- backlog depth
- effective outbound frame rate
- degraded mode transitions

Client-side:

- snapshot arrival intervals
- latest snapshot age
- presence/absence of interpolation next-frame window
- render delay evolution
- stream health state
- starvation duration
- replay horizon usage

### Acceptance Criteria

The refactor is successful if:

- the server no longer silently loses commits because of timer phase
- short jitter does not cause visible world hitching
- server under-run degrades into controlled slowdown/hold, not jerk bursts
- growing client-side delay degrades into increased visual delay and heavier
  local feel, not repeated snaps
- local-player reconciliation remains tick-based and stable
- remote entities recover from short starvation without harsh jumps
- rendered probe is stable enough to serve as a regression tool

## Non-Goals

This refactor should not:

- rewrite game simulation rules
- replace the transport protocol
- rewrite serialization format unless later justified
- introduce temporary magic constants as the long-term fix

## Risks

### 1. Over-Coupling Server And Client Policy

Mitigation:

- keep server metadata minimal
- let the client remain primary observer of actual stream quality

### 2. Too Much Client Extrapolation

Mitigation:

- keep tails short and type-specific
- use snap rules for discontinuities
- never rewrite authoritative history from extrapolated state

### 3. Unbounded Catch-Up Complexity

Mitigation:

- bounded catch-up only
- clear degraded transition rules
- observable scheduler metrics from the start

### 4. Rendered Probe Drift From Real Client

Mitigation:

- serve the same built assets as the real packaged client
- keep test instrumentation small and explicit

## Final Summary

This refactor is not just an interpolation tweak.

It is a structural cleanup of how the project handles:

- simulation progression
- snapshot transport cadence
- degraded replication
- client-side presentation buffering
- local-player prediction under stale authority

The target outcome is a networked world that remains stable, understandable, and
future-proof under both normal play and degraded conditions.
