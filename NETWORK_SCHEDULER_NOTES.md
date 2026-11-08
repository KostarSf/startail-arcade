# Snapshot publication and playback

Current implementation (2026-11-08):

- Physics advances at 20 Hz. Snapshot `serverTime` is `simTick * 50ms`.
- `Engine` calls `flushCommittedState()` after its catch-up loop. Publication is
  limited to one current snapshot per 50ms slot; it does not serialize obsolete
  intermediate ticks and does not claim that a same-thread timer avoids stalls.
- `baseSimTick` identifies the client's delta baseline. Visibility, change tracking
  and world events cover the range since the last transport-accepted snapshot.
- `send() === -1` is accepted; `0` is dropped and forces a full retry. Buffered
  peers are skipped before serialization. A peer that cannot accept a frame for
  200 simulation ticks is disconnected to bound retained world events.
- The client serializes decoding/application and invalidates pending work on
  reconnect. Baseline mismatch closes the connection rather than silently
  applying a broken delta chain.
- The presentation clock is monotonic, with a 100–400ms target buffer derived
  from observed cadence and p95 positive arrival jitter. Normal playback adjusts
  by at most ±10%; short starvation permits up to 60ms of extrapolation, then
  holds. A tab suspended for over a second may re-anchor forward to current
  history instead of replaying stale seconds. Local prediction consumes the newest authoritative snapshot separately.
- Initial ping samples sent before server initialization and high-RTT outliers
  are excluded from time synchronization.

Optimization tasks, validation evidence and remaining world/renderer work are
tracked in [OPTIMIZATION_CHECKLIST.md](OPTIMIZATION_CHECKLIST.md).

Repeatable rendered diagnostic (PowerShell, installed Edge):

```powershell
$env:PLAYWRIGHT_CHANNEL = 'msedge'
bun run probe:agent --client-mode=rendered --retro-rendering --debug-performance --duration=15000 --seed=42 --capture-debug-trace --sim-latency=40 --server-stall-ms=180
```

The stall endpoint accepts POST only, a bounded 0–250ms duration, and exists only
in test mode. The probe's artificial latency is fixed in each direction; it is
not a packet-loss or bandwidth emulator.

`--retro-rendering` keeps the test API but exercises the normal render texture and
edge filter. Browser application, graphics, text, event and filter extensions are
registered explicitly so the bundled renderer cannot silently stop drawing.
