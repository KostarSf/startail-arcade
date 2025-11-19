# bun-react-tailwind-template

To install dependencies:

```bash
bun install
```

To start a development server:

```bash
bun dev
```

To run for production:

```bash
bun start
```

This project was created using `bun init` in bun v1.3.2. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.

## Game Architecture

- Client rendering now runs on a lightweight ECS (see `src/shared/ecs`) with systems for input, interpolation, reconciliation, rendering and camera control defined under `src/client/game/systems`.
- Entity motion and ship physics live in shared modules (`src/shared/game/entities`), so both the Bun server and browser prediction use the exact same math.
- The client buffers server snapshots and renders entities at `predictedServerTime - 100ms` for jitter-free interpolation, while the local ship is reconciled immediately using an input buffer and shared ship simulation helpers.
- Player inputs are applied instantly on the client, queued with sequence numbers, and acknowledged by the server via `lastInputSequence` so divergence can be replayed deterministically.
- You can simulate higher latency locally by adding `?sim-latency=random` (20‑100 ms per refresh) or `?sim-latency=60` to the URL; the value delays both outgoing commands and incoming snapshots so the entire client stack experiences the imposed ping.
