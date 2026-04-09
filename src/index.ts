import { serve } from "bun";

import index from "./client/index.html";
import notSupported from "./client/not-supported.html";
import { Engine } from "./server/engine/engine";
import type { NetworkEvent } from "./shared/network/events";

function isMobileUserAgent(userAgent: string): boolean {
  const mobilePatterns = [
    /Android/i,
    /webOS/i,
    /iPhone/i,
    /iPad/i,
    /iPod/i,
    /BlackBerry/i,
    /Windows Phone/i,
    /Mobile/i,
  ];
  return mobilePatterns.some((pattern) => pattern.test(userAgent));
}

const engine = new Engine();
const args = typeof Bun !== "undefined" ? Bun.argv : process.argv;

if (args.includes("--debug-performance")) {
  engine.debug.performanceBreakdown = true;
}

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
    "/not-supported": notSupported,
    "/check-support": (req) => {
      console.log(req.url)
      const userAgent = req.headers.get("user-agent") || "";
      const isMobile = isMobileUserAgent(userAgent);
      return new Response(
        JSON.stringify({ supported: !isMobile }),
        {
          headers: { "Content-Type": "application/json" },
        }
      );
    },
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

if (engine.debug.performanceBreakdown) {
  console.log("[debug] performance breakdown enabled");
}

console.log(`🚀 Server running at ${server.url}`);
