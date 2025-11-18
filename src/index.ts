import { serve } from "bun";

import index from "./client/index.html";
import { Engine } from "./server/engine/engine";
import type { NetworkEvent } from "./shared/network/events";

const engine = new Engine();

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

const server = serve({
  routes: {
    "/ws": (req, server) => {
      if (server.upgrade(req)) {
        return new Response(null, { status: 101 });
      }
      return new Response("Upgrade failed", { status: 500 });
    },
    // Serve index.html for all unmatched routes.
    "/*": index,
  },

  websocket: {
    open: (ws) => {
      engine.network.connectPlayer(ws);
    },
    message: (ws, data) => {
      engine.network.onMessage(
        ws,
        JSON.parse(
          Buffer.isBuffer(data) ? data.toString("utf-8") : data
        ) as NetworkEvent
      );
    },
    close: (ws) => {
      engine.network.disconnectPlayer(ws);
    },
  },

  development: process.env.NODE_ENV !== "production" && {
    // Enable browser hot reloading in development
    hmr: true,

    // Echo console logs from the browser to the server
    console: true,
  },
});

engine.network.initialize(server);

console.log(`🚀 Server running at ${server.url}`);
