import { createGameServer, resolveGameServerOptions } from "./server/bootstrap";
import type { Engine } from "./server/engine/engine";

const gameServer = createGameServer(resolveGameServerOptions());
const { engine, options, server } = gameServer;

declare global {
  var game: { engine: Engine } | undefined;
}

if (process.env.NODE_ENV !== "production") {
  if (globalThis.game) {
    globalThis.game.engine.network.disconnectAllPlayers();
    globalThis.game.engine.stop();
  }
  globalThis.game = { engine };
}

if (engine.debug.performanceBreakdown) {
  console.log("[debug] performance breakdown enabled");
}

if (options.testMode) {
  console.log("[test] test routes enabled");
}

if (options.seed !== null) {
  console.log(`[test] seeded server RNG: ${options.seed}`);
}

console.log(`Server running at ${server.url}`);
