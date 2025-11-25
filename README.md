# StarTail Arcade

A multiplayer space shooter game built with modern web technologies. Battle other players, destroy asteroids, fight AI pirates, and climb the leaderboard in this real-time multiplayer arcade experience.

**Version:** v0.4.0

## Features

- **Multiplayer Real-Time Gameplay** - Compete with other players in a shared persistent world
- **Player Progression System** - Level up to increase health, energy, damage, and regeneration rates
- **Combat System** - Engage in fast-paced ship-to-ship combat with bullets and explosions
- **AI Enemies** - Face off against pirate ships that hunt high-level players
- **Dynamic World** - Navigate through procedurally generated asteroid fields
- **Leaderboard** - Compete for the top spot with real-time rankings
- **Radar System** - Track enemies, players, and valuable resources on your radar
- **Audio System** - Immersive music and sound effects with adjustable settings
- **Client-Side Prediction** - Smooth gameplay with server reconciliation for lag-free experience
- **Bounty Hunter Events** - Special pirate squad events that target top players

## Tech Stack

- **[Bun](https://bun.com)** - Fast JavaScript runtime for server and build tooling
- **[React 19](https://react.dev)** - Modern UI framework
- **[Pixi.js 8](https://pixijs.com)** - High-performance 2D WebGL rendering
- **[TypeScript](https://www.typescriptlang.org)** - Type-safe development
- **[Tailwind CSS 4](https://tailwindcss.com)** - Utility-first CSS framework
- **[Zustand](https://zustand-demo.pmnd.rs)** - Lightweight state management
- **WebSocket** - Real-time bidirectional communication
- **ECS Architecture** - Entity Component System for game logic

## Prerequisites

- [Bun](https://bun.sh) v1.3.2 or later

## Installation

```bash
# Install dependencies
bun install
```

## Development

Start the development server with hot module reloading:

```bash
bun dev
```

The server will start at `http://localhost:3000` (or the next available port).

### Development Features

- **Hot Module Reloading** - Automatic browser refresh on code changes
- **Console Logging** - Browser console logs are echoed to the server terminal
- **Latency Simulation** - Test network conditions by adding query parameters:
  - `?sim-latency=random` - Random latency between 20-100ms per refresh
  - `?sim-latency=60` - Fixed 60ms latency simulation

## Building

Build the production bundle:

```bash
bun run build
```

This will:
- Bundle and minify all client assets
- Generate source maps
- Output to the `dist/` directory
- Process HTML entry points with Tailwind CSS

### Build Options

The build script supports various options:

```bash
# Custom output directory
bun run build.ts --outdir=build

# Disable minification
bun run build.ts --no-minify

# Custom sourcemap type
bun run build.ts --sourcemap=inline

# See all options
bun run build.ts --help
```

## Production

Run the production server:

```bash
NODE_ENV=production bun start
```

Or simply:

```bash
bun start
```

## Deployment

### Docker

The project includes a Dockerfile for containerized deployment:

```bash
# Build the Docker image
docker build -t startail-arcade .

# Run the container
docker run -p 3000:3000 startail-arcade
```

The Dockerfile uses a multi-stage build:
1. **Builder stage** - Installs dependencies and builds the client bundle
2. **Production stage** - Copies only necessary files and runs the server

## Architecture

### Client-Server Architecture

The game uses a client-server architecture with authoritative server simulation:

- **Server** (`src/server/engine/`) - Runs the authoritative game simulation at 20 TPS
- **Client** (`src/client/`) - Handles rendering, input, and prediction
- **Shared** (`src/shared/`) - Common game logic used by both client and server

### Entity Component System (ECS)

The game uses a lightweight ECS architecture:

- **Components** (`src/shared/ecs/components.ts`) - Data structures
- **Systems** (`src/client/game/systems/`) - Client-side systems for rendering, input, interpolation, etc.
- **Entities** (`src/shared/game/entities/`) - Game entities (ships, bullets, asteroids, etc.)

### Network Synchronization

The game implements advanced networking techniques for smooth multiplayer gameplay:

- **Client-Side Prediction** - Player inputs are applied instantly on the client
- **Server Reconciliation** - Client state is corrected when server snapshots arrive
- **Entity Interpolation** - Entities are rendered at `predictedServerTime - 100ms` for jitter-free visuals
- **Input Buffering** - Player inputs are queued with sequence numbers and acknowledged by the server
- **Deterministic Replay** - Divergence between client and server can be replayed deterministically

### Shared Game Logic

Entity motion and ship physics live in shared modules (`src/shared/game/entities`), ensuring both the Bun server and browser prediction use the exact same math for deterministic simulation.

## Game Mechanics

### Leveling System

As players level up, they gain:
- Increased maximum health
- Increased maximum energy
- Faster energy regeneration (smaller relative increase than total energy)
- Higher damage output

### Pirate Bounty Hunter Events

Special events where pirate squads spawn to hunt the highest-level player:

- Pirates spawn in formations of 2-4 ships near the target player
- They move in organized formations toward their target
- Pirates will attack other players they encounter but return to their primary target
- Destroying pirates grants significant experience
- If the top player survives, subsequent waves become stronger and more frequent
- If the top player dies, pirate escalation resets

### Radar System

Press `Tab` to view detailed information:
- Radar display showing enemies, players, and valuable items
- Current/maximum health
- Current/maximum energy and regeneration rate
- Base damage
- Maximum speed
- Active buffs (when applicable)

## Project Structure

```
src/
├── client/              # Client-side code
│   ├── game/           # Game engine and systems
│   │   ├── systems/    # ECS systems (rendering, input, interpolation, etc.)
│   │   └── network/    # Network client code
│   ├── assets/         # Images, sounds, and other assets
│   ├── audio/          # Audio engine and settings
│   └── App.tsx         # Main React UI component
├── server/             # Server-side code
│   └── engine/         # Game server engine
│       ├── entities/   # Server-side entity logic
│       └── world/      # World generation and collision
└── shared/             # Shared code between client and server
    ├── ecs/            # ECS framework
    ├── game/           # Shared game logic
    ├── math/           # Math utilities
    └── network/        # Network protocol definitions
```

## Browser Compatibility

The game is designed for desktop browsers and includes mobile detection. Mobile users are redirected to a "not supported" page. The game requires:

- Modern browser with WebGL support
- WebSocket support
- ES2020+ JavaScript features

## Performance

- Server runs at 20 TPS (ticks per second)
- Client rendering targets 60 FPS
- Efficient spatial partitioning for collision detection
- Optimized rendering with Pixi.js batching
- Network state compression for reduced bandwidth

## Contributing

This is a private project. For questions or contributions, please contact the maintainers.

## License

Private - All rights reserved
