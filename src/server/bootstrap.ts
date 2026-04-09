import { serve } from "bun";

import index from "../client/index.html";
import notSupported from "../client/not-supported.html";
import { Random } from "../shared/math/random";
import type { NetworkEvent } from "../shared/network/events";
import { Engine } from "./engine/engine";

export type GameServerOptions = {
  port?: number;
  hostname?: string;
  debugPerformance?: boolean;
  testMode?: boolean;
  seed?: number | null;
};

export type ResolvedGameServerOptions = {
  port: number;
  hostname?: string;
  debugPerformance: boolean;
  testMode: boolean;
  seed: number | null;
};

type CliOptions = Record<string, string | boolean>;

const DEFAULT_PORT = 3000;
let installedMathRandomSeed: number | null = null;

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

function parseCliOptions(argv: string[]): CliOptions {
  const options: CliOptions = {};

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (!arg?.startsWith("--")) continue;

    if (arg.includes("=")) {
      const [rawKey, rawValue] = arg.slice(2).split("=", 2);
      if (!rawKey) continue;
      options[rawKey] = rawValue ?? true;
      continue;
    }

    const key = arg.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      options[key] = next;
      index++;
      continue;
    }

    options[key] = true;
  }

  return options;
}

function parseOptionalNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseBooleanEnv(value: string | undefined): boolean | undefined {
  if (!value) return undefined;

  const normalized = value.toLowerCase();
  if (normalized === "1" || normalized === "true") return true;
  if (normalized === "0" || normalized === "false") return false;

  return undefined;
}

function installSeededMathRandom(seed: number) {
  if (installedMathRandomSeed === seed) {
    return;
  }

  const rng = new Random(seed);
  Math.random = () => rng.next();
  installedMathRandomSeed = seed;
}

export function resolveGameServerOptions(
  argv: string[] = typeof Bun !== "undefined"
    ? Bun.argv.slice(2)
    : process.argv.slice(2),
  env: Record<string, string | undefined> = process.env
): ResolvedGameServerOptions {
  const cli = parseCliOptions(argv);
  const cliPort =
    typeof cli.port === "string" ? parseOptionalNumber(cli.port) : undefined;
  const cliSeed =
    typeof cli.seed === "string" ? parseOptionalNumber(cli.seed) : undefined;
  const hostname =
    typeof cli.hostname === "string" ? cli.hostname : env.HOST;

  return {
    port: cliPort ?? parseOptionalNumber(env.PORT) ?? DEFAULT_PORT,
    hostname,
    debugPerformance:
      cli["debug-performance"] === true ||
      (parseBooleanEnv(env.STARTAIL_DEBUG_PERFORMANCE) ?? false),
    testMode:
      cli["test-mode"] === true ||
      (parseBooleanEnv(env.STARTAIL_TEST_MODE) ?? false),
    seed: cliSeed ?? parseOptionalNumber(env.STARTAIL_TEST_SEED) ?? null,
  };
}

export function createGameServer(options: GameServerOptions = {}) {
  const resolved: ResolvedGameServerOptions = {
    port: options.port ?? DEFAULT_PORT,
    hostname: options.hostname,
    debugPerformance: options.debugPerformance ?? false,
    testMode: options.testMode ?? false,
    seed: options.seed ?? null,
  };

  if (resolved.seed !== null) {
    // The server still contains a fair amount of Math.random()-based gameplay
    // logic, so we seed process-wide randomness for reproducible probe runs.
    installSeededMathRandom(resolved.seed);
  }

  const engine = new Engine();

  if (resolved.debugPerformance) {
    engine.debug.performanceBreakdown = true;
  }

  const server = serve({
    port: resolved.port,
    hostname: resolved.hostname,
    routes: {
      "/not-supported": notSupported,
      "/check-support": (req) => {
        const userAgent = req.headers.get("user-agent") || "";
        return Response.json({
          supported: !isMobileUserAgent(userAgent),
        });
      },
      "/__test/health": () => {
        if (!resolved.testMode) {
          return new Response("Not found", { status: 404 });
        }

        return Response.json({
          ok: true,
          running: engine.running,
          tick: engine.tick,
          playerCount: engine.network.playerCount,
          serverTimeMs: Math.round(engine.serverTime),
        });
      },
      "/__test/metrics": () => {
        if (!resolved.testMode) {
          return new Response("Not found", { status: 404 });
        }

        return Response.json({
          running: engine.running,
          tick: engine.tick,
          serverTimeMs: Math.round(engine.serverTime),
          lastTickDurationMs: Math.round(engine.lastTickDuration * 100) / 100,
          playerCount: engine.network.playerCount,
          entityCount: engine.world.entities.length,
          entityCounts: engine.world.getEntityCountsByType(),
          performance: engine.lastPerformanceSummary,
          debug: {
            ...engine.debug,
          },
          seed: resolved.seed,
        });
      },
      "/__test/snapshot": () => {
        if (!resolved.testMode) {
          return new Response("Not found", { status: 404 });
        }

        return Response.json({
          running: engine.running,
          tick: engine.tick,
          serverTimeMs: Math.round(engine.serverTime),
          players: engine.network.getPlayerSnapshots(),
          entityCounts: engine.world.getEntityCountsByType(),
          seed: resolved.seed,
        });
      },
      "/ws": (req, activeServer) => {
        if (activeServer.upgrade(req)) {
          return new Response(null, { status: 101 });
        }
        return new Response("Upgrade failed", { status: 500 });
      },
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
      hmr: !resolved.testMode,
      console: true,
    },
  });

  engine.network.initialize(server);

  return {
    engine,
    options: resolved,
    server,
    stop() {
      engine.network.disconnectAllPlayers();
      engine.stop();
      server.stop(true);
    },
  };
}
