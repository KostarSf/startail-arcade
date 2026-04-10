# Network Scheduler Follow-Ups

This file captures improvements intentionally deferred while refactoring the
network cadence and tick-bound world events.

## Possible Next Steps

- Replace the plain `setInterval(50ms)` scheduler with a self-correcting timer
  so long-term drift is minimized under uneven event-loop load.
- Add OpenTelemetry spans/metrics around:
  - scheduler slot execution
  - per-player snapshot build
  - event-range collection
  - serialization
  - websocket send
- Revisit partial/full snapshot build cost:
  - reuse visibility query buffers
  - reduce repeated `visibleIds` recomputation
  - profile per-player delta generation separately from serialization
- Add backpressure-aware transport metrics:
  - send queue growth
  - skipped slots while no committed tick is available
  - effective outbound frame rate per player
- Expand event replication policies once needed:
  - direct/private delivery
  - precomputed relevance groups
  - richer retention/debug tooling
- Revisit client-side world event playback once more event kinds exist:
  - batching effect spawns
  - animation/audio prioritization under load
  - better diagnostics for delayed event playback relative to rendered tick
