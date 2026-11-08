import { Ship } from "../entities/ship";
import { PirateAI } from "../entities/ai/pirate-ai";
import { TPS } from "../constants";
import type { World } from "./world";

type PirateRecord = {
  ship: ReturnType<Ship["captureRuntimeState"]>;
  ai: ReturnType<PirateAI["captureState"]>;
  active: Ship | null;
  lastInterestedTick: number;
};

/** All pirates exist logically; only near-player or combat pirates own live Ship graphs. */
export class PirateRoster {
  #records = new Map<string, PirateRecord>();
  readonly limit = 50;
  constructor(private world: World) {}
  initialize() {
    this.clear();
    for (let i = 0; i < this.limit; i++) this.#create();
  }
  #create() {
    const r = this.world.borderRadius;
    const x = (Math.random() * 2 - 1) * r;
    const y = (Math.random() * 2 - 1) * r;
    // Replacement pirates must not appear inside a player's active region.
    if (
      this.world.engine.network.players.some(
        (p) => p.ship && !p.ship.removed && this.world.distance(p.ship, { x, y }) < 2200,
      )
    )
      return;
    const ship = new Ship({
      x,
      y,
      angle: Math.random() * Math.PI * 2,
      name: "???",
    });
    const ai = new PirateAI();
    ai.ensureInitialized(ship, this.world);
    this.#records.set(ship.id, {
      ship: ship.captureRuntimeState(),
      ai: ai.captureState(),
      active: null,
      lastInterestedTick: -Infinity,
    });
  }
  update() {
    const tick = this.world.engine.tick;
    const players = this.world.engine.network.players
      .map((p) => p.ship)
      .filter((s): s is Ship => !!s && !s.removed);
    for (const record of this.#records.values()) {
      const ship = record.active,
        position = ship ?? record.ship.body;
      const near = players.some((p) => this.world.distance(p, position) < (ship ? 3000 : 2200));
      const fighting = ship?.ai instanceof PirateAI && ship.ai.keepsActive(this.world);
      if (near || fighting) {
        record.lastInterestedTick = tick;
        if (!ship) {
          const body = new Ship(record.ship.body);
          body.restoreRuntimeState(record.ship);
          const ai = new PirateAI(record.ai.level);
          ai.restoreState(record.ai);
          body.ai = ai;
          record.active = body;
          this.world.spawn(body);
        }
      } else if (ship && !ship.removed && tick - record.lastInterestedTick > TPS * 10) {
        record.ship = ship.captureRuntimeState();
        record.ai = (ship.ai as PirateAI).captureState();
        this.world.detach(ship);
        record.active = null;
      }
    }
    if (tick % (TPS * 20) === 0 && this.#records.size < this.limit) this.#create();
  }
  remove(ship: Ship) {
    this.#records.delete(ship.id);
  }
  get active() {
    return [...this.#records.values()].flatMap((r) => (r.active ? [r.active] : []));
  }
  getStats() {
    return {
      total: this.#records.size,
      active: this.active.length,
      background: this.#records.size - this.active.length,
    };
  }
  getSnapshots() {
    return [...this.#records.values()].map((r) => ({
      ...(r.active?.toJSON() ?? r.ship.body),
      earnablePoints: r.active?.earnablePoints ?? r.ship.earnablePoints,
      active: r.active !== null,
      initialized: r.active?.initialized ?? false,
      pursuitTargetId: r.active?.ai instanceof PirateAI ? r.active.ai.pursuitTargetId : null,
    }));
  }
  clear() {
    this.#records.clear();
  }
}
